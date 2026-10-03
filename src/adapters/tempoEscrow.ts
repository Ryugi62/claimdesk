import { createClient, http, publicActions, walletActions, encodeAbiParameters, keccak256, parseEventLogs, type Account, type Chain } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { tempoActions } from 'viem/tempo'
import { claimEscrowAbi, claimEscrowBytecode } from './claimEscrowArtifact'
import type { ClaimKeys, ClaimSubmitter, EscrowGateway, Hex, NewAward, TxRef } from '../application/ports'
import type { EscrowEvent } from '../domain/status'

export function tempoClient(chain: Chain, account?: Account, rpcUrl?: string) {
  return createClient({ chain, transport: http(rpcUrl), account }).extend(publicActions).extend(walletActions).extend(tempoActions())
}
type Client = ReturnType<typeof tempoClient>

async function txRef(client: Client, receipt: { transactionHash: Hex; blockNumber: bigint; status: string }): Promise<TxRef> {
  if (receipt.status !== 'success') throw new Error(`transaction ${receipt.transactionHash} reverted`)
  const block = await client.getBlock({ blockNumber: receipt.blockNumber })
  return { hash: receipt.transactionHash, blockTime: new Date(Number(block.timestamp) * 1000) }
}

/** Deploys a new ClaimEscrow owned by the client's account. */
export async function deployEscrow(client: Client): Promise<{ address: Hex; tx: TxRef; block: bigint }> {
  const hash = await client.deployContract({ abi: claimEscrowAbi, bytecode: claimEscrowBytecode as Hex, account: client.account!, chain: client.chain })
  const receipt = await client.waitForTransactionReceipt({ hash })
  if (!receipt.contractAddress) throw new Error('deploy failed')
  return { address: receipt.contractAddress as Hex, tx: await txRef(client, receipt as never), block: receipt.blockNumber }
}

const tip20Abi = [
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
] as const

export async function approve(client: Client, token: Hex, spender: Hex, amount: bigint): Promise<TxRef> {
  const hash = await client.writeContract({ address: token, abi: tip20Abi, functionName: 'approve', args: [spender, amount], account: client.account!, chain: client.chain })
  return txRef(client, (await client.waitForTransactionReceipt({ hash })) as never)
}

export async function balanceOf(client: Client, token: Hex, who: Hex): Promise<bigint> {
  return client.readContract({ address: token, abi: tip20Abi, functionName: 'balanceOf', args: [who] })
}

/** Organizer's view of its escrow (organizer key signs fund/clear/reclaim). */
export class TempoEscrow implements EscrowGateway {
  constructor(private client: Client, readonly address: Hex, private fromBlock: bigint) {}
  get chainId() { return this.client.chain!.id }

  private async write(functionName: 'fund' | 'clear' | 'reclaim', args: readonly unknown[]): Promise<TxRef> {
    const hash = await this.client.writeContract({ address: this.address, abi: claimEscrowAbi, functionName, args: args as never, account: this.client.account!, chain: this.client.chain })
    return txRef(this.client, (await this.client.waitForTransactionReceipt({ hash })) as never)
  }
  fund(a: NewAward) { return this.write('fund', [a.id, a.token, a.amount, BigInt(a.expiresAt), a.claimSigner, a.memo]) }
  clear(id: Hex, paperworkHash: Hex) { return this.write('clear', [id, paperworkHash]) }
  reclaim(id: Hex) { return this.write('reclaim', [id]) }

  async statusOf(id: Hex): Promise<number> {
    return Number(await this.client.readContract({ address: this.address, abi: claimEscrowAbi, functionName: 'statusOf', args: [id] }))
  }

  async events(): Promise<EscrowEvent[]> {
    const logs = await this.client.getLogs({ address: this.address, fromBlock: this.fromBlock, toBlock: 'latest' })
    const parsed = parseEventLogs({ abi: claimEscrowAbi, logs })
    return parsed.map((l): EscrowEvent => {
      const a = l.args as Record<string, unknown>
      const base = { id: a.id as string, txHash: l.transactionHash as string }
      switch (l.eventName) {
        case 'Funded': return { kind: 'Funded', ...base, amount: a.amount as bigint, expiresAt: Number(a.expiresAt) }
        case 'Cleared': return { kind: 'Cleared', ...base, paperworkHash: a.paperworkHash as string }
        case 'Claimed': return { kind: 'Claimed', ...base, recipient: a.recipient as string }
        default: return { kind: 'Reclaimed', ...base }
      }
    })
  }
  async chainTime(): Promise<number> {
    return Number((await this.client.getBlock()).timestamp)
  }
}

/** Claim keys are plain secp256k1 keys; the escrow checks the signature with ecrecover. */
export const viemClaimKeys: ClaimKeys = {
  create() {
    const privateKey = generatePrivateKey()
    return { privateKey, address: privateKeyToAccount(privateKey).address }
  },
  async signClaim({ claimKey, escrow, chainId, id, recipient }) {
    const inner = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }, { type: 'bytes32' }, { type: 'address' }], [escrow, BigInt(chainId), id, recipient]))
    return privateKeyToAccount(claimKey).signMessage({ message: { raw: inner } })
  },
}

/**
 * The winner's account sends claim(); the organizer's fee payer pays the fee (Tempo native fee sponsorship).
 * `sender` is the winner (no balance needed), `feePayer` is the organizer's sponsor key.
 */
export class SponsoredClaimSubmitter implements ClaimSubmitter {
  /** `feePayer`: a local sponsor account, or `true` when the client's transport relays to a sponsoring server. */
  constructor(private senderClient: Client, private feePayer: Account | true) {}
  async submit({ escrow, id, recipient, signature }: { escrow: Hex; id: Hex; recipient: Hex; signature: Hex }): Promise<TxRef> {
    const receipt = await this.senderClient.writeContractSync({
      address: escrow, abi: claimEscrowAbi, functionName: 'claim', args: [id, recipient, signature],
      account: this.senderClient.account!, chain: this.senderClient.chain, feePayer: this.feePayer,
    } as never)
    return txRef(this.senderClient, receipt as never)
  }
}

export { claimEscrowAbi }
