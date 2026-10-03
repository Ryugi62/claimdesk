/**
 * Organizer CLI (testnet).
 *   npm run cli -- deploy [--min-ttl-days 14] [--tax-account 0x… --max-withhold-pct 30]
 *                                                  new escrow + a separate fee-payer key (both funded from the testnet faucet)
 *   npm run cli -- batch winners.csv --days 14     fund every award in ONE transaction; private claim links → batches/
 *   npm run cli -- clear <REF> --recipient 0x… --paperwork "<what was collected>" [--withhold-pct 30]
 *                                                  --recipient = the payout address written in the winner's paperwork (never read from chain)
 *   npm run cli -- reissue <REF>                   new link key; the old link and its registration stop counting
 *   npm run cli -- verify <REF>                    re-derive the on-chain paperwork hash from the local record
 *   npm run cli -- revoke <REF>                    before clearance; money returns now
 *   npm run cli -- reclaim <REF>                   after expiry
 *   npm run cli -- status                          one line per award, from the chain's own events
 */
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { Actions } from 'viem/tempo'
import { tempoClient, deployEscrow, TempoEscrow, viemClaimKeys, readAward, ZERO } from '../adapters/tempoEscrow'
import { createBatch, fundBatch, statusBoard } from '../application/payouts'
import { encodeClaimLink } from '../domain/claimLink'
import { recordPaperwork, verifyAgainst } from './paperwork'
import { parseWinners } from '../domain/award'
import { awardMemo, memoToRef } from '../domain/memo'
import { formatUnits } from '../domain/receipt'
import { describe } from '../domain/status'
import { CHAIN, EXPLORER, PATH_USD, readEnv, requireEnv, setEnv } from './config'
import type { Hex } from '../application/ports'

const [cmd, ...rest] = process.argv.slice(2)
const flag = (name: string, d?: string) => (rest.includes(`--${name}`) ? rest[rest.indexOf(`--${name}`) + 1] : d)

function key(name: string): Hex {
  const k = readEnv()[name]
  if (k) return k as Hex
  const fresh = generatePrivateKey()
  setEnv(name, fresh)
  return fresh
}
const organizer = privateKeyToAccount(key('ORGANIZER_KEY_TESTNET'))
const org = tempoClient(CHAIN, organizer)
const escrow = () => new TempoEscrow(org, requireEnv('ESCROW') as Hex, BigInt(requireEnv('ESCROW_BLOCK')))

async function main() {
  switch (cmd) {
    case 'deploy': {
      const feePayer = privateKeyToAccount(key('FEE_PAYER_KEY_TESTNET'))
      await Actions.faucet.fundSync(org, { account: organizer.address })
      await Actions.faucet.fundSync(org, { account: feePayer.address })
      const tax = flag('tax-account') as Hex | undefined
      const d = await deployEscrow(org, { minTtlSeconds: Number(flag('min-ttl-days', '14')) * 86_400, taxAccount: tax ?? ZERO, maxWithholdingBps: tax ? Math.round(Number(flag('max-withhold-pct', '30')) * 100) : 0 })
      setEnv('ESCROW', d.address)
      setEnv('ESCROW_BLOCK', d.block.toString())
      console.log(`escrow ${d.address} (organizer ${organizer.address}, fee payer ${feePayer.address})\n${EXPLORER}/address/${d.address}`)
      break
    }
    case 'batch': {
      const file = rest[0]
      const seconds = Number(flag('seconds', String(Number(flag('days', '14')) * 86_400)))
      const base = flag('base', 'http://localhost:5174')!
      const e = escrow()
      const winners = parseWinners(readFileSync(file, 'utf8'), 6)
      const plan = createBatch(winners, viemClaimKeys, { baseUrl: base, escrow: e.address, chainId: CHAIN.id })
      const expiresAt = Number((await org.getBlock()).timestamp) + seconds
      const tx = await fundBatch(plan, e, PATH_USD, expiresAt)
      mkdirSync('batches', { recursive: true })
      const out = `batches/${file.replace(/^.*\//, '').replace(/\.csv$/, '')}-${Date.now()}.links.json`
      writeFileSync(out, JSON.stringify(plan.map((p) => ({ ref: p.ref, label: p.label, amount: formatUnits(p.amount, 6), link: p.link })), null, 2))
      chmodSync(out, 0o600)
      console.log(`${plan.length} awards funded in one transaction ${EXPLORER}/tx/${tx.hash}\nexpires ${new Date(expiresAt * 1000).toISOString()}\nclaim links (private, owner-only file — send each to its winner only): ${out}`)
      break
    }
    case 'clear': {
      const ref = rest[0]
      const e = escrow()
      const award = await readAward(org, e.address, awardMemo(ref))
      const bearer = rest.includes('--bearer')
      const expected = (bearer ? ZERO : flag('recipient')) as Hex | undefined
      if (!expected) throw new Error('pass --recipient <the payout address written in the paperwork> (or --bearer to open a bearer claim)')
      if (!bearer && expected.toLowerCase() !== (award.registered ?? '').toLowerCase()) throw new Error(`the paperwork names ${expected} but the link registered ${award.registered ?? 'nothing'} — reissue the link`)
      const { hash } = recordPaperwork(ref, expected, flag('paperwork', '') ?? '')
      const pct = Number(flag('withhold-pct', '0'))
      const withheld = (award.amount * BigInt(Math.round(pct * 100))) / 10_000n
      const tx = await e.clear(awardMemo(ref), hash, expected, withheld)
      console.log(`cleared ${ref} for ${expected === ZERO ? 'a bearer claim' : expected}${withheld ? `, withheld ${formatUnits(withheld, 6)}` : ''} (paperwork hash ${hash})\n${EXPLORER}/tx/${tx.hash}`)
      break
    }
    case 'reissue': {
      const ref = rest[0]
      const k = viemClaimKeys.create()
      const tx = await escrow().reissueLink(awardMemo(ref), k.address)
      const link = encodeClaimLink(flag('base', 'http://localhost:5174')!, { chainId: CHAIN.id, escrow: requireEnv('ESCROW'), ref, claimKey: k.privateKey })
      console.log(`new link for ${ref} (send it to the verified winner only):\n${link}\n${EXPLORER}/tx/${tx.hash}`)
      break
    }
    case 'verify': {
      const ref = rest[0]
      const v = (await statusBoard(escrow()))[awardMemo(ref)]
      const rec = v?.paperworkHash ? verifyAgainst(v.paperworkHash, ref) : undefined
      console.log(rec ? `on-chain hash ${v!.paperworkHash} = local record of ${rec.at}: ${rec.paperwork}` : `no local record matches ${v?.paperworkHash ?? '(not cleared)'}`)
      break
    }
    case 'revoke':
    case 'reclaim': {
      const tx = await escrow()[cmd](awardMemo(rest[0]))
      console.log(`${cmd}ed ${rest[0]}\n${EXPLORER}/tx/${tx.hash}`)
      break
    }
    case 'status': {
      for (const v of Object.values(await statusBoard(escrow()))) {
        console.log([memoToRef(v.id).padEnd(20), describe(v).organizer.padEnd(58), v.amount !== undefined ? formatUnits(v.amount, 6).padStart(10) : '', v.recipient ?? v.registered ?? ''].join('  '))
      }
      break
    }
    default:
      console.log('commands: deploy [--min-ttl-days 14] [--tax-account 0x… --max-withhold-pct 30] | batch <winners.csv> [--days N] [--base URL] | clear <REF> --recipient 0x… --paperwork "..." [--withhold-pct N] | clear <REF> --bearer | reissue <REF> | verify <REF> | revoke <REF> | reclaim <REF> | status')
  }
}

main().catch((e) => {
  console.error((e as Error).message.split('\n')[0])
  process.exit(1)
})
