/**
 * Physical verification on Tempo Moderato testnet (SPEC §10). Every refusal is a MINED transaction with a hash.
 *  1 deploy (organizer key) · separate fee-payer key · faucet
 *  2 fund 5 awards in ONE batched Tempo transaction
 *  3 path A: winner registers an account (fee sponsored) → organizer clears → paid in the clearing transaction
 *  4 path B: claim before clearance (reverts NotCleared) → clear → sponsored claim (paid) → claim again (AlreadySettled)
 *  5 copied signature + different recipient (BadClaimSignature) · revoke → register after revoke (AlreadySettled)
 *  6 60-second award: claim after expiry (Expired) → organizer reclaims
 *  7 status board from events · receipt with the ECB rate
 * Writes docs/live/moderato-<ts>.json. Keys: testnet-only, in .env.local (git-ignored).
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { encodeFunctionData, decodeErrorResult, keccak256, toHex, type Account } from 'viem'
import { Actions } from 'viem/tempo'
import { tempoClient, deployEscrow, balanceOf, TempoEscrow, TempoWinner, viemClaimKeys, claimEscrowAbi, type TempoClient } from '../src/adapters/tempoEscrow'
import { EcbRates } from '../src/adapters/ecbRates'
import { createBatch, fundBatch, claimAward, registerAccount, statusBoard, receiptFor } from '../src/application/payouts'
import { parseWinners } from '../src/domain/award'
import { parseClaimLink } from '../src/domain/claimLink'
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

/** Sends a claim()/register() that is EXPECTED to revert, with a fixed gas limit so it is mined; returns hash + decoded error. */
async function mustRevert(sender: TempoClient, feePayer: Account, escrow: Hex, functionName: 'claim' | 'register', args: readonly [Hex, Hex, Hex]) {
  const data = encodeFunctionData({ abi: claimEscrowAbi, functionName, args })
  const send = async () => {
    const hash = (await sender.sendTransaction({ to: escrow, data, gas: 400_000n, feePayer, account: sender.account!, chain: sender.chain } as never)) as Hex
    return (await sender.waitForTransactionReceipt({ hash })) as unknown as { transactionHash: Hex; status: string; blockNumber: bigint }
  }
  const receipt = await send().catch(async (e) => {
    if (!/HTTP request failed/.test(String((e as Error).message))) throw e
    await new Promise((r) => setTimeout(r, 1500)) // public RPC hiccup (502) — one retry
    return send()
  })
  let error = 'unknown'
  try {
    await sender.call({ account: sender.account!, to: escrow, data, blockNumber: receipt.blockNumber })
  } catch (e) {
    const raw = (e as { walk?: (f: (x: unknown) => boolean) => { data?: Hex } | undefined }).walk?.((x) => typeof (x as { data?: unknown }).data === 'string')?.data
    try { error = raw ? decodeErrorResult({ abi: claimEscrowAbi, data: raw }).errorName : (e as Error).message.split('\n')[0] } catch { error = (e as Error).message.split('\n')[0] }
  }
  return { tx: receipt.transactionHash, status: receipt.status, error, link: `${EXPLORER}/tx/${receipt.transactionHash}` }
}

async function main() {
  const organizer = privateKeyToAccount(key('E2E_ORGANIZER_KEY_TESTNET'))
  const feePayer = privateKeyToAccount(key('E2E_FEE_PAYER_KEY_TESTNET'))
  const org = tempoClient(CHAIN, organizer)
  await Actions.faucet.fundSync(org, { account: organizer.address })
  await Actions.faucet.fundSync(org, { account: feePayer.address })
  record('keys', { organizer: organizer.address, feePayer: feePayer.address })

  const dep = await deployEscrow(org)
  record('deploy', { escrow: dep.address, tx: dep.tx.hash, link: `${EXPLORER}/address/${dep.address}` })
  const escrow = new TempoEscrow(org, dep.address, dep.block)

  const winners = parseWinners('ref,amount,label\nWF-E2E-A,25,registers early\nWF-E2E-B,15,bearer claim\nWF-E2E-C,10,revoked\nWF-E2E-D,5,expires in 60s\nWF-E2E-E,7,redirect attempt\n', 6)
  const plan = createBatch(winners, viemClaimKeys, { baseUrl: 'http://localhost:5174', escrow: dep.address, chainId: CHAIN.id })
  const now = Number((await org.getBlock()).timestamp)
  const long = plan.filter((p) => p.ref !== 'WF-E2E-D')
  const fundTx = await fundBatch(long, escrow, PATH_USD, now + 86_400)
  const fundRcpt = await org.getTransactionReceipt({ hash: fundTx.hash })
  const shortTx = await fundBatch(plan.filter((p) => p.ref === 'WF-E2E-D'), escrow, PATH_USD, now + 60)
  record('fund-batch', { awards: long.length, tx: fundTx.hash, gasUsed: fundRcpt.gasUsed, gasPerAward: fundRcpt.gasUsed / BigInt(long.length), shortExpiryTx: shortTx.hash })
  const [A, B, C, D, E] = plan

  // fresh winner accounts with zero balance; fees for their transactions are paid by the fee payer
  const winnerA = privateKeyToAccount(generatePrivateKey())
  const winnerB = privateKeyToAccount(generatePrivateKey())
  const thief = privateKeyToAccount(generatePrivateKey())
  const cA = tempoClient(CHAIN, winnerA)
  const cB = tempoClient(CHAIN, winnerB)
  const sponsorOf = (c: TempoClient) => new TempoWinner(c, feePayer)

  // path A — register early, paid by the clearing transaction
  const reg = await registerAccount(A.link, winnerA.address, viemClaimKeys, sponsorOf(cA), { chainId: CHAIN.id })
  const beforeA = await balanceOf(org, PATH_USD, winnerA.address)
  const clrA = await escrow.clear(A.id, keccak256(toHex(JSON.stringify({ ref: A.ref, w8ben: 'received', identity: 'checked', acceptance: 'signed' }))))
  const afterA = await balanceOf(org, PATH_USD, winnerA.address)
  record('path-A-register-then-clear', { ref: A.ref, registerTx: reg.hash, clearTx: clrA.hash, link: `${EXPLORER}/tx/${clrA.hash}`, winnerBefore: beforeA, winnerAfter: afterA, winnerSignedNothingThatCost: true })

  // path B — bearer claim
  const dB = parseClaimLink(B.link)
  const sigB = await viemClaimKeys.sign({ purpose: 'claim', claimKey: dB.claimKey as Hex, escrow: dep.address, chainId: CHAIN.id, id: B.id, recipient: winnerB.address })
  record('refused-before-clearance', { ref: B.ref, ...(await mustRevert(cB, feePayer, dep.address, 'claim', [B.id, winnerB.address, sigB])) })
  await escrow.clear(B.id, keccak256(toHex(B.ref)))
  const t0 = Date.now()
  const paidB = await claimAward(B.link, winnerB.address, viemClaimKeys, sponsorOf(cB), { chainId: CHAIN.id })
  record('path-B-claim-paid', { ref: B.ref, tx: paidB.hash, link: `${EXPLORER}/tx/${paidB.hash}`, ms: Date.now() - t0, winnerAfter: await balanceOf(org, PATH_USD, winnerB.address) })
  record('refused-claim-twice', { ref: B.ref, ...(await mustRevert(cB, feePayer, dep.address, 'claim', [B.id, winnerB.address, sigB])) })

  // copied signature, different recipient
  await escrow.clear(E.id, keccak256(toHex(E.ref)))
  const dE = parseClaimLink(E.link)
  const sigForWinner = await viemClaimKeys.sign({ purpose: 'claim', claimKey: dE.claimKey as Hex, escrow: dep.address, chainId: CHAIN.id, id: E.id, recipient: winnerB.address })
  record('refused-redirect', { ref: E.ref, ...(await mustRevert(tempoClient(CHAIN, thief), feePayer, dep.address, 'claim', [E.id, thief.address, sigForWinner])) })

  // revoke, then the link is dead
  const orgBeforeRevoke = await balanceOf(org, PATH_USD, organizer.address)
  const rev = await escrow.revoke(C.id)
  const dC = parseClaimLink(C.link)
  const sigC = await viemClaimKeys.sign({ purpose: 'register', claimKey: dC.claimKey as Hex, escrow: dep.address, chainId: CHAIN.id, id: C.id, recipient: winnerB.address })
  record('revoke', { ref: C.ref, tx: rev.hash, organizerDelta: (await balanceOf(org, PATH_USD, organizer.address)) - orgBeforeRevoke })
  record('refused-after-revoke', { ref: C.ref, ...(await mustRevert(cB, feePayer, dep.address, 'register', [C.id, winnerB.address, sigC])) })

  // expiry
  await escrow.clear(D.id, keccak256(toHex(D.ref)))
  while (Number((await org.getBlock()).timestamp) < now + 61) await new Promise((r) => setTimeout(r, 2000))
  const dD = parseClaimLink(D.link)
  const sigD = await viemClaimKeys.sign({ purpose: 'claim', claimKey: dD.claimKey as Hex, escrow: dep.address, chainId: CHAIN.id, id: D.id, recipient: winnerB.address })
  record('refused-after-expiry', { ref: D.ref, ...(await mustRevert(cB, feePayer, dep.address, 'claim', [D.id, winnerB.address, sigD])) })
  const rec = await escrow.reclaim(D.id)
  record('reclaim', { ref: D.ref, tx: rec.hash })

  const board = await statusBoard(escrow)
  record('status-board', Object.fromEntries(Object.values(board).map((v) => [memoToRef(v.id), v.status])))
  const receipt = await receiptFor({ ref: B.ref, amount: B.amount, decimals: 6, symbol: 'pathUSD', tx: paidB, memo: B.id, recipient: winnerB.address }, new EcbRates(), 'KRW')
  record('receipt', receipt as unknown as Record<string, unknown>)
  record('fees', { winnersPaidFees: 0, feePayerSpent: 'see fee-payer account on explorer', feePayerExplorer: `${EXPLORER}/address/${feePayer.address}` })

  mkdirSync('docs/live', { recursive: true })
  const file = `docs/live/moderato-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  writeFileSync(file, JSON.stringify({ chainId: CHAIN.id, explorer: EXPLORER, escrow: dep.address, log }, big, 2))
  console.log('written', file)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
