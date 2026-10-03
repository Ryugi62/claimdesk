/**
 * Organizer CLI (testnet).
 *   npm run cli -- deploy                          new escrow + a separate fee-payer key (both funded from the testnet faucet)
 *   npm run cli -- batch winners.csv --days 14     fund every award in ONE transaction; private claim links → batches/
 *   npm run cli -- clear <REF> --paperwork "<what was collected>"   (pays the winner now if they registered an account)
 *   npm run cli -- revoke <REF>                    before clearance; money returns now
 *   npm run cli -- reclaim <REF>                   after expiry
 *   npm run cli -- status                          one line per award, from the chain's own events
 */
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { keccak256, toHex } from 'viem'
import { Actions } from 'viem/tempo'
import { tempoClient, deployEscrow, TempoEscrow, viemClaimKeys } from '../adapters/tempoEscrow'
import { createBatch, fundBatch, statusBoard } from '../application/payouts'
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
      const d = await deployEscrow(org)
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
      const paperwork = flag('paperwork', 'paperwork complete')!
      const hash = keccak256(toHex(JSON.stringify({ ref, paperwork, at: new Date().toISOString() })))
      const tx = await escrow().clear(awardMemo(ref), hash)
      console.log(`cleared ${ref} (paperwork hash ${hash})\n${EXPLORER}/tx/${tx.hash}`)
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
        console.log([memoToRef(v.id).padEnd(18), describe(v).organizer.padEnd(40), v.amount !== undefined ? formatUnits(v.amount, 6).padStart(10) : '', v.recipient ?? v.registered ?? ''].join('  '))
      }
      break
    }
    default:
      console.log('commands: deploy | batch <winners.csv> [--days N] [--base URL] | clear <REF> [--paperwork "..."] | revoke <REF> | reclaim <REF> | status')
  }
}

main().catch((e) => {
  console.error((e as Error).message.split('\n')[0])
  process.exit(1)
})
