import { createClient, custom, decodeErrorResult, publicActions, walletActions, encodeAbiParameters, encodeFunctionData, keccak256, toBytes, parseEventLogs, type Account, type Chain, type Transport } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { tempoActions } from 'viem/tempo'
import { claimEscrowAbi, claimEscrowBytecode } from './claimEscrowArtifact'
import type { ClaimKeys, EscrowGateway, Hex, NewAward, TxRef, WinnerGateway } from '../application/ports'
import type { EscrowEvent } from '../domain/status'

/**
 * JSON-RPC over HTTP that rides out public-RPC hiccups (HTTP 5xx, "no healthy upstreams" -32002, rate limits):
 * retries up to 8 times with backoff. Re-sending a signed transaction is idempotent (same hash).
 */
export function resilientHttp(url?: string, tries = 8): Transport {
  return (config) => {
    const target = url ?? config.chain?.rpcUrls.default.http[0]
    if (!target) throw new Error('no RPC url')
    let id = 0
    return custom({
      async request({ method, params }) {
        let last: unknown
        for (let i = 0; i < tries; i++) {
          try {
            const res = await fetch(target, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) })
            if (res.status >= 500 || res.status === 429) throw new Error(`HTTP ${res.status}`)
            const body = (await res.json()) as { result?: unknown; error?: { code: number; message: string; data?: unknown } }
            if (body.error) {
              if ([-32002, -32005, -32603].includes(body.error.code) && !/revert/i.test(body.error.message)) throw new Error(body.error.message)
              throw Object.assign(new Error(body.error.message), { code: body.error.code, data: body.error.data, final: true })
            }
            return body.result
          } catch (e) {
            if ((e as { final?: boolean }).final) throw e
            last = e
            await new Promise((r) => setTimeout(r, 600 * (i + 1)))
          }
        }
        throw last
      },
    }, { retryCount: 0 })(config)
  }
}

export function tempoClient(chain: Chain, account?: Account, transport?: Transport) {
  return createClient({ chain, transport: transport ?? resilientHttp(), account }).extend(publicActions).extend(walletActions).extend(tempoActions())
}
export type TempoClient = ReturnType<typeof tempoClient>

export const ZERO = '0x0000000000000000000000000000000000000000' as Hex
export const STATUS = ['None', 'Funded', 'Registered', 'Cleared', 'Claimed', 'Expired', 'Reclaimed', 'Revoked'] as const

export async function txRef(client: TempoClient, receipt: { transactionHash: Hex; blockNumber: bigint; status: string }): Promise<TxRef> {
  if (receipt.status !== 'success') throw new Error(`transaction ${receipt.transactionHash} reverted`)
  const block = await client.getBlock({ blockNumber: receipt.blockNumber })
  return { hash: receipt.transactionHash, blockTime: new Date(Number(block.timestamp) * 1000) }
}

/** Deploys a new ClaimEscrow; `organizer` becomes its owner (defaults to the deployer). */
export async function deployEscrow(client: TempoClient, opts: { organizer?: Hex; minTtlSeconds?: number; taxAccount?: Hex; maxWithholdingBps?: number } = {}): Promise<{ address: Hex; tx: TxRef; block: bigint }> {
  const hash = await client.deployContract({
    abi: claimEscrowAbi, bytecode: claimEscrowBytecode as Hex,
    args: [opts.organizer ?? client.account!.address, BigInt(opts.minTtlSeconds ?? 7 * 86_400), opts.taxAccount ?? ZERO, opts.maxWithholdingBps ?? 0],
    account: client.account!, chain: client.chain,
  })
  const receipt = await client.waitForTransactionReceipt({ hash })
  if (!receipt.contractAddress) throw new Error('deploy failed')
  return { address: receipt.contractAddress as Hex, tx: await txRef(client, receipt as never), block: receipt.blockNumber }
}

export const tip20Abi = [
  { type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { type: 'function', name: 'balanceOf', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
  { type: 'function', name: 'transferWithMemo', stateMutability: 'nonpayable', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }, { name: 'memo', type: 'bytes32' }], outputs: [] },
] as const

export async function balanceOf(client: TempoClient, token: Hex, who: Hex): Promise<bigint> {
  return client.readContract({ address: token, abi: tip20Abi, functionName: 'balanceOf', args: [who] })
}

export async function tokenMeta(client: TempoClient, token: Hex): Promise<{ symbol: string; decimals: number }> {
  const [symbol, decimals] = await Promise.all([
    client.readContract({ address: token, abi: tip20Abi, functionName: 'symbol' }),
    client.readContract({ address: token, abi: tip20Abi, functionName: 'decimals' }),
  ])
  return { symbol, decimals: Number(decimals) }
}

export interface OnchainAward {
  token: Hex
  amount: bigint
  expiresAt: number
  /** the registered account (status Registered), else undefined */
  registered?: Hex
  status: (typeof STATUS)[number]
}

export async function readAward(client: TempoClient, escrow: Hex, id: Hex): Promise<OnchainAward> {
  const [a, s] = await Promise.all([
    client.readContract({ address: escrow, abi: claimEscrowAbi, functionName: 'awardOf', args: [id] }) as Promise<{ token: Hex; amount: bigint; party: Hex; expiresAt: bigint; status: number }>,
    client.readContract({ address: escrow, abi: claimEscrowAbi, functionName: 'statusOf', args: [id] }),
  ])
  return { token: a.token, amount: a.amount, expiresAt: Number(a.expiresAt), registered: STATUS[a.status] === 'Registered' ? a.party : undefined, status: STATUS[Number(s)] }
}

function toEvent(l: { eventName: string; args: unknown; transactionHash: Hex | null }): EscrowEvent | undefined {
  const a = l.args as Record<string, unknown>
  const base = { id: a.id as string, txHash: (l.transactionHash ?? undefined) as string | undefined }
  switch (l.eventName) {
    case 'Funded': return { kind: 'Funded', ...base, amount: a.amount as bigint, expiresAt: Number(a.expiresAt) }
    case 'Registered': return { kind: 'Registered', ...base, recipient: a.recipient as string }
    case 'RecipientChanged': return { kind: 'RecipientChanged', ...base, recipient: a.next as string }
    case 'LinkReissued': return { kind: 'LinkReissued', ...base }
    case 'Cleared': return { kind: 'Cleared', ...base, paperworkHash: a.paperworkHash as string, withheld: a.withheld as bigint }
    case 'Claimed': return { kind: 'Claimed', ...base, recipient: a.recipient as string, amount: a.amount as bigint }
    case 'Revoked': return { kind: 'Revoked', ...base }
    case 'Reclaimed': return { kind: 'Reclaimed', ...base }
    default: return undefined // Organizer* — not part of the award status
  }
}

/** Escrow events, optionally for one award only (filtered by the indexed id topic), scanned in bounded block ranges. */
export async function escrowEvents(client: TempoClient, escrow: Hex, fromBlock: bigint, id?: Hex, step = 100_000n): Promise<EscrowEvent[]> {
  const latest = await client.getBlockNumber()
  const out: EscrowEvent[] = []
  for (let from = fromBlock; from <= latest; from += step) {
    const to = from + step - 1n > latest ? latest : from + step - 1n
    const logs = await client.request({
      method: 'eth_getLogs',
      params: [{ address: escrow, fromBlock: `0x${from.toString(16)}`, toBlock: `0x${to.toString(16)}`, topics: id ? [null, id] : [] }],
    } as never) as never[]
    for (const l of parseEventLogs({ abi: claimEscrowAbi, logs })) {
      const e = toEvent(l as never)
      if (e) out.push(e)
    }
  }
  return out
}

/** Organizer's view of its escrow (the organizer key signs fund/clear/revoke/reclaim). */
export class TempoEscrow implements EscrowGateway {
  constructor(private client: TempoClient, readonly address: Hex, private fromBlock: bigint) {}
  get chainId() { return this.client.chain!.id }

  private async send(calls: { to: Hex; data: Hex }[]): Promise<TxRef> {
    const hash = await this.client.sendTransaction({ calls, account: this.client.account!, chain: this.client.chain } as never)
    return txRef(this.client, (await this.client.waitForTransactionReceipt({ hash })) as never)
  }
  private call(functionName: 'clear' | 'revoke' | 'reclaim' | 'reissueLink', args: readonly unknown[]) {
    return { to: this.address, data: encodeFunctionData({ abi: claimEscrowAbi, functionName, args: args as never }) }
  }

  /** approve(total) + fund(award) × N in one Tempo transaction (batched calls — all or nothing). */
  fundMany(token: Hex, awards: NewAward[]) {
    const total = awards.reduce((n, a) => n + a.amount, 0n)
    return this.send([
      { to: token, data: encodeFunctionData({ abi: tip20Abi, functionName: 'approve', args: [this.address, total] }) },
      ...awards.map((a) => ({ to: this.address, data: encodeFunctionData({ abi: claimEscrowAbi, functionName: 'fund', args: [a.id, a.token, a.amount, BigInt(a.expiresAt), a.claimSigner] }) })),
    ])
  }
  clear(id: Hex, paperworkHash: Hex, expectedRecipient: Hex, withheld = 0n) {
    return this.send([this.call('clear', [id, paperworkHash, expectedRecipient, withheld])])
  }
  /** Several clearances in one Tempo transaction (batched calls — all or nothing). */
  clearMany(items: { id: Hex; paperworkHash: Hex; expectedRecipient: Hex; withheld?: bigint }[]) {
    return this.send(items.map((i) => this.call('clear', [i.id, i.paperworkHash, i.expectedRecipient, i.withheld ?? 0n])))
  }
  reissueLink(id: Hex, newSigner: Hex) { return this.send([this.call('reissueLink', [id, newSigner])]) }
  revoke(id: Hex) { return this.send([this.call('revoke', [id])]) }
  reclaim(id: Hex) { return this.send([this.call('reclaim', [id])]) }
  events(id?: Hex) { return escrowEvents(this.client, this.address, this.fromBlock, id) }
  async chainTime() { return Number((await this.client.getBlock()).timestamp) }
}

/** Claim keys are plain secp256k1 keys; the escrow checks the signature with ecrecover. */
export function claimDigestInner(purpose: 'claim' | 'register', escrow: Hex, chainId: number, id: Hex, recipient: Hex): Hex {
  return keccak256(encodeAbiParameters(
    [{ type: 'bytes32' }, { type: 'address' }, { type: 'uint256' }, { type: 'bytes32' }, { type: 'address' }],
    [keccak256(toBytes(`claimdesk.${purpose}`)), escrow, BigInt(chainId), id, recipient],
  ))
}

export const viemClaimKeys: ClaimKeys = {
  create() {
    const privateKey = generatePrivateKey()
    return { privateKey, address: privateKeyToAccount(privateKey).address }
  },
  async sign({ purpose, claimKey, escrow, chainId, id, recipient }) {
    return privateKeyToAccount(claimKey).signMessage({ message: { raw: claimDigestInner(purpose, escrow, chainId, id, recipient) } })
  },
}

/**
 * The winner side: `client.account` sends register()/claim() (it needs no balance);
 * `feePayer` is a local sponsor account, or `true` when the client's transport relays to a sponsoring service.
 */
export class TempoWinner implements WinnerGateway {
  constructor(private client: TempoClient, private feePayer: Account | true) {}
  private async send(functionName: 'register' | 'claim', a: { escrow: Hex; id: Hex; recipient: Hex; signature: Hex }): Promise<TxRef> {
    const hash = await this.client.writeContract({
      address: a.escrow, abi: claimEscrowAbi, functionName, args: [a.id, a.recipient, a.signature],
      account: this.client.account!, chain: this.client.chain, feePayer: this.feePayer,
    } as never)
    return txRef(this.client, (await this.client.waitForTransactionReceipt({ hash })) as never)
  }
  register(a: { escrow: Hex; id: Hex; recipient: Hex; signature: Hex }) { return this.send('register', a) }
  claim(a: { escrow: Hex; id: Hex; recipient: Hex; signature: Hex }) { return this.send('claim', a) }
}

/** The escrow's custom error name inside a viem error (e.g. "RecipientMismatch"), else the first line of the message. */
export function explainRevert(e: unknown): string {
  const raw = (e as { walk?: (f: (x: unknown) => boolean) => { data?: unknown } | undefined }).walk?.((x) => typeof (x as { data?: unknown }).data === 'string' && String((x as { data: string }).data).startsWith('0x'))?.data
  if (typeof raw === 'string') {
    try {
      return decodeErrorResult({ abi: claimEscrowAbi, data: raw as Hex }).errorName
    } catch { /* not ours */ }
  }
  return String((e as Error).message ?? e).split('\n')[0]
}

export { claimEscrowAbi }
