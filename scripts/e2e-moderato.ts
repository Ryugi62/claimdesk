/**
 * Physical verification on Tempo Moderato testnet (SPEC §10). Every refusal is a MINED transaction with a hash.
 *  deploy (organizer key, minTtl 60 s for this test escrow) · separate fee-payer key · faucet
 *  A  register (sponsored) → clear for that account → paid in the clearing tx · the same link again → WrongState
 *  F  a forwarded link registers first → clear for the real winner → RecipientMismatch → reissue link →
 *     old link → BadClaimSignature → winner registers with the new link → paid
 *  G  register → clear with 30% withheld → tax account + winner both paid with the memo
 *  B  bearer: claim before clearance → WrongState → clear(0) → sponsored claim → claim again → WrongState
 *  E  copied claim signature to another address → BadClaimSignature
 *  C  revoke → money back now → register after revoke → WrongState
 *  D  75-second award → claim after expiry → Expired → reclaim
 * Writes docs/live/moderato-<ts>.json. Keys: testnet-only, in .env.local (git-ignored).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { encodeFunctionData, decodeErrorResult, keccak256, toHex, type Account } from 'viem'
import { Actions } from 'viem/tempo'
import { tempoClient, deployEscrow, balanceOf, TempoEscrow, TempoWinner, viemClaimKeys, claimEscrowAbi, ZERO, type TempoClient } from '../src/adapters/tempoEscrow'
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
  record('keys', { organizer: organizer.address, feePayer: feePayer.address })

  const dep = await deployEscrow(org, { minTtlSeconds: 60 })
  record('deploy', { escrow: dep.address, minTtlSeconds: 60, tx: dep.tx.hash, link: `${EXPLORER}/address/${dep.address}` })
  const escrow = new TempoEscrow(org, dep.address, dep.block)

  const winners = parseWinners('ref,amount,label\nWF-E2E-A,25,registers early\nWF-E2E-F,20,forwarded link\nWF-E2E-G,100,withholding\nWF-E2E-B,15,bearer\nWF-E2E-E,7,redirect\nWF-E2E-C,10,revoked\nWF-E2E-D,5,expires\n', 6)
  const plan = createBatch(winners, viemClaimKeys, { baseUrl: 'http://localhost:5174', escrow: dep.address, chainId: CHAIN.id })
  const P = Object.fromEntries(plan.map((p) => [p.ref.slice(-1), p]))
  const now = Number((await org.getBlock()).timestamp)
  const long = plan.filter((p) => p !== P.D)
  const fundTx = await fundBatch(long, escrow, PATH_USD, now + 86_400)
  const fundRcpt = await org.getTransactionReceipt({ hash: fundTx.hash })
  const shortTx = await fundBatch([P.D], escrow, PATH_USD, now + 75)
  record('fund-batch', { awards: long.length, tx: fundTx.hash, gasUsed: fundRcpt.gasUsed, gasPerAward: fundRcpt.gasUsed / BigInt(long.length), shortExpiryTx: shortTx.hash })

  const fresh = () => privateKeyToAccount(generatePrivateKey())
  const gw = (c: TempoClient) => new TempoWinner(c, feePayer)
  const keyOf = (ref: string) => parseClaimLink(plan.find((p) => p.ref === ref)!.link).claimKey as Hex
  const sign = (purpose: 'claim' | 'register', ref: string, recipient: Hex, claimKey = keyOf(ref)) =>
    viemClaimKeys.sign({ purpose, claimKey, escrow: dep.address, chainId: CHAIN.id, id: plan.find((p) => p.ref === ref)!.id, recipient })

  // A — register early; clearing for that account pays it; the link is powerless afterwards
  const wA = fresh(); const cA = tempoClient(CHAIN, wA)
  const regA = await registerAccount(P.A.link, wA.address, viemClaimKeys, gw(cA), { chainId: CHAIN.id })
  const clrA = await escrow.clear(P.A.id, hashOf('A paperwork'), wA.address)
  record('A-register-then-clear', { registerTx: regA.hash, clearTx: clrA.hash, link: `${EXPLORER}/tx/${clrA.hash}`, winnerAfter: await balanceOf(org, PATH_USD, wA.address) })
  const x = fresh()
  record('A-link-reused-after-registration', await mustRevert(tempoClient(CHAIN, x), feePayer, dep.address, call('register', [P.A.id, x.address, await sign('register', P.A.ref, x.address)])))

  // F — a forwarded link registers first; the organizer's clearance names the real winner → refused → new link → paid
  const wF = fresh(); const thief = fresh()
  await registerAccount(P.F.link, thief.address, viemClaimKeys, gw(tempoClient(CHAIN, thief)), { chainId: CHAIN.id })
  record('F-clear-for-real-winner-refused', await mustRevert(org, undefined, dep.address, call('clear', [P.F.id, hashOf('F kyc'), wF.address, 0n, ZERO])))
  const newKey = viemClaimKeys.create()
  const reissue = await escrow.reissueLink(P.F.id, newKey.address)
  record('F-old-link-refused', await mustRevert(tempoClient(CHAIN, thief), feePayer, dep.address, call('register', [P.F.id, thief.address, await sign('register', P.F.ref, thief.address)])))
  const newLink = encodeClaimLink('http://localhost:5174', { chainId: CHAIN.id, escrow: dep.address, ref: P.F.ref, claimKey: newKey.privateKey })
  const regF = await registerAccount(newLink, wF.address, viemClaimKeys, gw(tempoClient(CHAIN, wF)), { chainId: CHAIN.id })
  const clrF = await escrow.clear(P.F.id, hashOf('F kyc'), wF.address)
  record('F-reissued-and-paid', { reissueTx: reissue.hash, registerTx: regF.hash, clearTx: clrF.hash, winnerAfter: await balanceOf(org, PATH_USD, wF.address), thiefAfter: await balanceOf(org, PATH_USD, thief.address) })

  // G — withholding at source
  const wG = fresh(); const taxAccount = fresh()
  await registerAccount(P.G.link, wG.address, viemClaimKeys, gw(tempoClient(CHAIN, wG)), { chainId: CHAIN.id })
  const clrG = await escrow.clear(P.G.id, hashOf('G w8ben no treaty'), wG.address, 30_000_000n, taxAccount.address)
  record('G-withholding', { clearTx: clrG.hash, winnerAfter: await balanceOf(org, PATH_USD, wG.address), taxAccountAfter: await balanceOf(org, PATH_USD, taxAccount.address) })

  // B — bearer path
  const wB = fresh(); const cB = tempoClient(CHAIN, wB)
  const sigB = await sign('claim', P.B.ref, wB.address)
  record('B-claim-before-clearance-refused', await mustRevert(cB, feePayer, dep.address, call('claim', [P.B.id, wB.address, sigB])))
  await escrow.clear(P.B.id, hashOf('B'), ZERO)
  const t0 = Date.now()
  const paidB = await claimAward(P.B.link, wB.address, viemClaimKeys, gw(cB), { chainId: CHAIN.id })
  record('B-bearer-claim-paid', { tx: paidB.hash, link: `${EXPLORER}/tx/${paidB.hash}`, seconds: (Date.now() - t0) / 1000, winnerAfter: await balanceOf(org, PATH_USD, wB.address) })
  record('B-claim-twice-refused', await mustRevert(cB, feePayer, dep.address, call('claim', [P.B.id, wB.address, sigB])))

  // E — copied signature, different recipient
  await escrow.clear(P.E.id, hashOf('E'), ZERO)
  const t = fresh()
  record('E-redirect-refused', await mustRevert(tempoClient(CHAIN, t), feePayer, dep.address, call('claim', [P.E.id, t.address, await sign('claim', P.E.ref, wB.address)])))

  // C — revoke
  const before = await balanceOf(org, PATH_USD, organizer.address)
  const rev = await escrow.revoke(P.C.id)
  record('C-revoke', { tx: rev.hash, organizerDelta: (await balanceOf(org, PATH_USD, organizer.address)) - before })
  record('C-register-after-revoke-refused', await mustRevert(cB, feePayer, dep.address, call('register', [P.C.id, wB.address, await sign('register', P.C.ref, wB.address)])))

  // D — expiry
  await escrow.clear(P.D.id, hashOf('D'), ZERO)
  while (Number((await org.getBlock()).timestamp) < now + 76) await new Promise((r) => setTimeout(r, 2000))
  record('D-claim-after-expiry-refused', await mustRevert(cB, feePayer, dep.address, call('claim', [P.D.id, wB.address, await sign('claim', P.D.ref, wB.address)])))
  record('D-reclaim', { tx: (await escrow.reclaim(P.D.id)).hash })

  const board = await statusBoard(escrow)
  record('status-board', Object.fromEntries(Object.values(board).map((v) => [memoToRef(v.id), v.status])))
  record('receipt-G', (await receiptFor({ ref: P.G.ref, amount: 70_000_000n, decimals: 6, symbol: 'pathUSD', tx: clrG, memo: P.G.id, recipient: wG.address, withheld: 30_000_000n }, new EcbRates(), 'KRW')) as unknown as Record<string, unknown>)

  mkdirSync('docs/live', { recursive: true })
  const file = `docs/live/moderato-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  writeFileSync(file, JSON.stringify({ chainId: CHAIN.id, explorer: EXPLORER, escrow: dep.address, log }, big, 2))
  console.log('written', file)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
