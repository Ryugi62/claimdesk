/**
 * Physical verification on Tempo Moderato testnet (SPEC §10).
 * deploy → fund 4 awards → claim before clearance (refused) → clear → sponsored claim (paid, winner had 0)
 * → claim again (refused) → redirected recipient (refused) → let one expire → claim (refused) → reclaim
 * → status board from chain events → receipt with the ECB rate. Writes docs/live/moderato-<ts>.json.
 *
 * Keys: testnet-only keys in .env.local (created on first run, git-ignored). No real funds anywhere.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tempoModerato } from 'viem/chains'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { BaseError, ContractFunctionRevertedError, keccak256, toHex } from 'viem'
import { Actions } from 'viem/tempo'
import { tempoClient, deployEscrow, approve, balanceOf, TempoEscrow, viemClaimKeys, SponsoredClaimSubmitter, claimEscrowAbi } from '../src/adapters/tempoEscrow'
import { EcbRates } from '../src/adapters/ecbRates'
import { createBatch, fundBatch, claimAward, statusBoard, receiptFor } from '../src/application/payouts'
import { parseWinners } from '../src/domain/award'
import { parseClaimLink } from '../src/domain/claimLink'
import type { Hex } from '../src/application/ports'

const PATH_USD = '0x20c0000000000000000000000000000000000000' as Hex
const EXPLORER = 'https://explore.testnet.tempo.xyz'
const ENV = '.env.local'

function loadOrCreateKey(name: string): Hex {
  const env = existsSync(ENV) ? readFileSync(ENV, 'utf8') : ''
  const m = env.match(new RegExp(`^${name}=(0x[0-9a-fA-F]{64})$`, 'm'))
  if (m) return m[1] as Hex
  const k = generatePrivateKey()
  writeFileSync(ENV, env + `${name}=${k}\n`)
  return k
}

const log: Record<string, unknown>[] = []
function record(step: string, data: Record<string, unknown>) {
  const row = { step, ...data }
  log.push(row)
  console.log(JSON.stringify(row, (_, v) => (typeof v === 'bigint' ? v.toString() : v)))
}

async function revertName(fn: () => Promise<unknown>): Promise<string> {
  try {
    await fn()
    return 'NO_REVERT'
  } catch (e) {
    if (e instanceof BaseError) {
      const r = e.walk((x) => x instanceof ContractFunctionRevertedError)
      if (r instanceof ContractFunctionRevertedError) return r.data?.errorName ?? r.reason ?? 'reverted'
    }
    return `error: ${(e as Error).message.split('\n')[0]}`
  }
}

async function main() {
  const organizer = privateKeyToAccount(loadOrCreateKey('ORGANIZER_KEY_TESTNET'))
  const org = tempoClient(tempoModerato, organizer)
  record('organizer', { address: organizer.address })

  // testnet faucet (public RPC method, no account): organizer only — winners start at 0
  const fundTx = await Actions.faucet.fundSync(org, { account: organizer.address })
  record('faucet', { txs: (fundTx as unknown as { transactionHash: string }[]).map((r) => r.transactionHash) })

  const dep = await deployEscrow(org)
  record('deploy', { escrow: dep.address, tx: dep.tx.hash, link: `${EXPLORER}/address/${dep.address}` })
  const escrow = new TempoEscrow(org, dep.address, dep.block)

  const max = 10n ** 30n
  await approve(org, PATH_USD, dep.address, max)

  const winners = parseWinners('ref,amount,label\nWF-DEMO-01,25,Paid after paperwork\nWF-DEMO-02,15,Waiting for paperwork\nWF-DEMO-03,10,Unclaimed\nWF-DEMO-04,5,Expires in 60s\n', 6)
  const plan = createBatch(winners, viemClaimKeys, { baseUrl: 'http://127.0.0.1:5174', escrow: dep.address, chainId: tempoModerato.id })
  const now = Number((await org.getBlock()).timestamp)
  await fundBatch(plan.slice(0, 3), escrow, PATH_USD, now + 86_400)
  const shortTx = await escrow.fund({ id: plan[3].id, token: PATH_USD, amount: plan[3].amount, expiresAt: now + 60, claimSigner: plan[3].claimSigner, memo: plan[3].memo })
  record('fund', { awards: plan.map((p) => ({ ref: p.ref, amount: p.amount })), shortExpiryTx: shortTx.hash })

  // winner 1: a brand-new account with zero balance
  const winner = privateKeyToAccount(generatePrivateKey())
  const winnerClient = tempoClient(tempoModerato, winner)
  const submitter = new SponsoredClaimSubmitter(winnerClient, organizer)
  record('winner', { address: winner.address, pathUsdBefore: await balanceOf(org, PATH_USD, winner.address) })

  // 1) claim before paperwork → NotCleared
  const early = await revertName(() => claimAward(plan[0].link, winner.address, viemClaimKeys, submitter, { chainId: tempoModerato.id }))
  record('claim-before-clearance', { ref: plan[0].ref, refusedWith: early })

  // 2) organizer clears paperwork (hash of the off-chain record only)
  const paperworkHash = keccak256(toHex(JSON.stringify({ ref: plan[0].ref, w8ben: 'received 2026-10-04', identity: 'checked', acceptance: 'signed' })))
  const clr = await escrow.clear(plan[0].id, paperworkHash)
  record('clear', { ref: plan[0].ref, tx: clr.hash, paperworkHash })

  // 3) sponsored claim → paid
  const t0 = Date.now()
  const paid = await claimAward(plan[0].link, winner.address, viemClaimKeys, submitter, { chainId: tempoModerato.id })
  const after = await balanceOf(org, PATH_USD, winner.address)
  record('claim-paid', { ref: plan[0].ref, tx: paid.hash, link: `${EXPLORER}/tx/${paid.hash}`, ms: Date.now() - t0, winnerPathUsdAfter: after, sponsoredBy: organizer.address })

  // 4) the same link again → AlreadySettled
  const again = await revertName(() => claimAward(plan[0].link, winner.address, viemClaimKeys, submitter, { chainId: tempoModerato.id }))
  record('claim-again', { ref: plan[0].ref, refusedWith: again })

  // 5) someone copies winner 2's signature but swaps in their own address → BadClaimSignature
  await escrow.clear(plan[1].id, keccak256(toHex(plan[1].ref)))
  const thief = privateKeyToAccount(generatePrivateKey())
  const d = parseClaimLink(plan[1].link)
  const sigForWinner = await viemClaimKeys.signClaim({ claimKey: d.claimKey as Hex, escrow: dep.address, chainId: tempoModerato.id, id: plan[1].id, recipient: winner.address })
  const redirect = await revertName(() => winnerClient.simulateContract({ address: dep.address, abi: claimEscrowAbi, functionName: 'claim', args: [plan[1].id, thief.address, sigForWinner], account: winner }))
  record('claim-redirected', { ref: plan[1].ref, refusedWith: redirect })

  // 6) wait for the 60 s award to expire → claim refused → organizer reclaims
  await escrow.clear(plan[3].id, keccak256(toHex(plan[3].ref)))
  while (Number((await org.getBlock()).timestamp) < now + 61) await new Promise((r) => setTimeout(r, 2000))
  const late = await revertName(() => claimAward(plan[3].link, winner.address, viemClaimKeys, submitter, { chainId: tempoModerato.id }))
  const orgBefore = await balanceOf(org, PATH_USD, organizer.address)
  const rec = await escrow.reclaim(plan[3].id)
  const orgAfter = await balanceOf(org, PATH_USD, organizer.address)
  record('expired', { ref: plan[3].ref, claimRefusedWith: late, reclaimTx: rec.hash, organizerDelta: orgAfter - orgBefore })

  // 7) status board from the chain's own events
  const board = await statusBoard(escrow)
  record('status-board', Object.fromEntries(Object.values(board).map((v) => [v.id, v.status])))

  // 8) receipt for winner 1, local amount in KRW at the ECB rate on/before the block date
  const receipt = await receiptFor({ ref: plan[0].ref, amount: plan[0].amount, decimals: 6, symbol: 'pathUSD', tx: paid, memo: plan[0].memo, recipient: winner.address }, new EcbRates(), 'KRW')
  record('receipt', receipt as unknown as Record<string, unknown>)

  mkdirSync('docs/live', { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const file = `docs/live/moderato-${stamp}.json`
  writeFileSync(file, JSON.stringify({ chainId: tempoModerato.id, explorer: EXPLORER, escrow: dep.address, log }, (_, v) => (typeof v === 'bigint' ? v.toString() : v), 2))
  console.log('written', file)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
