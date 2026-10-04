/**
 * v8 proof on Tempo Moderato (SPEC AC-21): a forwarded link registers first, the organizer schedules a new link,
 * the forwardee's changeRecipient during the notice is a MINED refusal (WrongState), and the new link executes after it.
 * Writes docs/live/moderato-v8-<ts>.json. Keys: testnet-only, in .env.local (git-ignored).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { encodeFunctionData, decodeErrorResult, keccak256, toHex, type Account } from 'viem'
import { Actions } from 'viem/tempo'
import { tempoClient, deployEscrow, balanceOf, TempoEscrow, TempoWinner, viemClaimKeys, claimEscrowAbi, paperworkDigest, ZERO, type TempoClient } from '../src/adapters/tempoEscrow'
import { EcbRates } from '../src/adapters/ecbRates'
import { createBatch, fundBatch, claimAward, registerAccount, statusBoard, receiptFor } from '../src/application/payouts'
import { parseWinners } from '../src/domain/award'
import { parseClaimLink, encodeClaimLink } from '../src/domain/claimLink'
import { memoToRef } from '../src/domain/memo'
import { CHAIN, EXPLORER, PATH_USD, readEnv, setEnv } from '../src/infrastructure/config'
import type { Hex } from '../src/application/ports'

function key(name: string): Hex {
  const k = readEnv()[name]
  if (k) return k as Hex
  const fresh = generatePrivateKey()
  setEnv(name, fresh)
  return fresh
}
const log: Record<string, unknown>[] = []
const big = (_: string, v: unknown) => (typeof v === 'bigint' ? v.toString() : v)
function record(step: string, data: Record<string, unknown>) {
  const row = { step, ...data }
  log.push(row)
  console.log(JSON.stringify(row, big))
}
const hashOf = (s: string) => keccak256(toHex(s))
/** the winner's own signature over its paperwork record — verified on-chain by Tempo's signature-verifier precompile */
async function signedPaperwork(winner: { sign: (a: { hash: Hex }) => Promise<Hex> }, escrow: Hex, id: Hex, address: Hex, record: string) {
  const recordHash = hashOf(record)
  return { recordHash, signature: await winner.sign({ hash: paperworkDigest(escrow, CHAIN.id, id, address, recordHash) }) }
}

/** Sends a call EXPECTED to revert, with a fixed gas limit so it is mined; returns hash + decoded custom error. */
async function mustRevert(sender: TempoClient, feePayer: Account | undefined, to: Hex, data: Hex) {
  const send = async () => {
    const hash = (await sender.sendTransaction({ to, data, gas: 400_000n, ...(feePayer ? { feePayer } : {}), account: sender.account!, chain: sender.chain } as never)) as Hex
    return (await sender.waitForTransactionReceipt({ hash })) as unknown as { transactionHash: Hex; status: string; blockNumber: bigint }
  }
  const receipt = await send().catch(async (e) => {
    if (!/HTTP request failed/.test(String((e as Error).message))) throw e
    await new Promise((r) => setTimeout(r, 1500))
    return send()
  })
  let error = 'unknown'
  try {
    await sender.call({ account: sender.account!, to, data, blockNumber: receipt.blockNumber })
  } catch (e) {
    const raw = (e as { walk?: (f: (x: unknown) => boolean) => { data?: Hex } | undefined }).walk?.((x) => typeof (x as { data?: unknown }).data === 'string')?.data
    try { error = raw ? decodeErrorResult({ abi: claimEscrowAbi, data: raw }).errorName : (e as Error).message.split('\n')[0] } catch { error = (e as Error).message.split('\n')[0] }
  }
  return { tx: receipt.transactionHash, status: receipt.status, error, link: `${EXPLORER}/tx/${receipt.transactionHash}` }
}
const call = (functionName: string, args: readonly unknown[]) => encodeFunctionData({ abi: claimEscrowAbi, functionName: functionName as never, args: args as never })

async function main() {
  const organizer = privateKeyToAccount(key('E2E_ORGANIZER_KEY_TESTNET'))
  const feePayer = privateKeyToAccount(key('E2E_FEE_PAYER_KEY_TESTNET'))
  const org = tempoClient(CHAIN, organizer)
  await Actions.faucet.fundSync(org, { account: organizer.address })
  await Actions.faucet.fundSync(org, { account: feePayer.address })
  const dep = await deployEscrow(org, { minTtlSeconds: 60, taxAccount: ZERO, maxWithholdingBps: 0, reissueDelaySeconds: 20 })
  record('deploy-v8', { escrow: dep.address, reissueDelaySeconds: 20, tx: dep.tx.hash, link: `${EXPLORER}/address/${dep.address}` })
  const escrow = new TempoEscrow(org, dep.address, dep.block)
  const plan = createBatch(parseWinners('ref,amount,label\nWF-V8-F,20,forwarded link\n', 6), viemClaimKeys, { baseUrl: 'http://localhost:5174', escrow: dep.address, chainId: CHAIN.id })
  const F = plan[0]
  const now = Number((await org.getBlock()).timestamp)
  const fundTx = await fundBatch(plan, escrow, PATH_USD, now + 86_400)
  record('fund', { tx: fundTx.hash })
  const thief = privateKeyToAccount(generatePrivateKey())
  await Actions.faucet.fundSync(org, { account: thief.address })
  const reg = await registerAccount(F.link, thief.address, viemClaimKeys, new TempoWinner(tempoClient(CHAIN, thief), feePayer), { chainId: CHAIN.id })
  record('forwardee-registered-first', { tx: reg })
  const newKey = viemClaimKeys.create()
  const scheduled = await escrow.reissueLink(F.id, newKey.address)
  record('new-link-scheduled', { tx: scheduled.hash })
  record('forwardee-changeRecipient-during-notice-refused', await mustRevert(tempoClient(CHAIN, thief), undefined, dep.address, call('changeRecipient', [F.id, privateKeyToAccount(generatePrivateKey()).address])))
  await new Promise((r) => setTimeout(r, 22_000))
  const executed = await escrow.reissueLink(F.id, newKey.address)
  const after = (await statusBoard(escrow))[F.id]
  record('new-link-issued-after-notice', { tx: executed.hash, statusAfter: after.status })
  if (after.status !== 'Funded') throw new Error('reissue did not execute')
  mkdirSync('docs/live', { recursive: true })
  const file = `docs/live/moderato-v8-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  writeFileSync(file, JSON.stringify(log, big, 2))
  console.log('wrote', file)
}
main().catch((e) => { console.error(e); process.exit(1) })
