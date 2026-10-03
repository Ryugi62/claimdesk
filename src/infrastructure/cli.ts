/**
 * Organizer CLI (testnet).
 *   npm run cli -- deploy                         new escrow owned by the organizer key (+ faucet on testnet)
 *   npm run cli -- batch winners.csv --days 14    fund one award per row, write private claim links to batches/
 *   npm run cli -- clear <REF> --paperwork "<what was collected>"
 *   npm run cli -- status                         one line per award, from the chain's own events
 *   npm run cli -- reclaim <REF>                  after expiry
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { keccak256, toHex } from 'viem'
import { Actions } from 'viem/tempo'
import { tempoClient, deployEscrow, approve, TempoEscrow, viemClaimKeys } from '../adapters/tempoEscrow'
import { createBatch, fundBatch, statusBoard } from '../application/payouts'
import { parseWinners } from '../domain/award'
import { awardMemo, memoToRef } from '../domain/memo'
import { formatUnits } from '../domain/receipt'
import { CHAIN, EXPLORER, PATH_USD, readEnv, requireEnv, setEnv } from './config'
import type { Hex } from '../application/ports'

const [cmd, ...rest] = process.argv.slice(2)
const flag = (name: string, d?: string) => (rest.includes(`--${name}`) ? rest[rest.indexOf(`--${name}`) + 1] : d)

function organizerKey(): Hex {
  const k = readEnv().ORGANIZER_KEY_TESTNET
  if (k) return k as Hex
  const fresh = generatePrivateKey()
  setEnv('ORGANIZER_KEY_TESTNET', fresh)
  return fresh
}
const organizer = privateKeyToAccount(organizerKey())
const org = tempoClient(CHAIN, organizer)
const escrow = () => new TempoEscrow(org, requireEnv('ESCROW') as Hex, BigInt(requireEnv('ESCROW_BLOCK')))

async function main() {
  switch (cmd) {
    case 'deploy': {
      await Actions.faucet.fundSync(org, { account: organizer.address })
      const d = await deployEscrow(org)
      await approve(org, PATH_USD, d.address, 10n ** 30n)
      setEnv('ESCROW', d.address)
      setEnv('ESCROW_BLOCK', d.block.toString())
      console.log(`escrow ${d.address}\n${EXPLORER}/address/${d.address}`)
      break
    }
    case 'batch': {
      const file = rest[0]
      const days = Number(flag('days', '14'))
      const seconds = Number(flag('seconds', String(days * 86_400)))
      const base = flag('base', 'http://localhost:5174')!
      const e = escrow()
      const winners = parseWinners(readFileSync(file, 'utf8'), 6)
      const plan = createBatch(winners, viemClaimKeys, { baseUrl: base, escrow: e.address, chainId: CHAIN.id })
      const expiresAt = Number((await org.getBlock()).timestamp) + seconds
      const txs = await fundBatch(plan, e, PATH_USD, expiresAt)
      mkdirSync('batches', { recursive: true })
      const out = `batches/${file.replace(/^.*\//, '').replace(/\.csv$/, '')}-${Date.now()}.links.json`
      writeFileSync(out, JSON.stringify(plan.map((p, i) => ({ ref: p.ref, label: p.label, amount: formatUnits(p.amount, 6), link: p.link, fundTx: txs[i].hash })), null, 2))
      console.log(`${plan.length} awards funded, expires ${new Date(expiresAt * 1000).toISOString()}\nclaim links (private — send each to its winner only): ${out}`)
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
    case 'reclaim': {
      const tx = await escrow().reclaim(awardMemo(rest[0]))
      console.log(`reclaimed ${rest[0]}\n${EXPLORER}/tx/${tx.hash}`)
      break
    }
    case 'status': {
      const board = await statusBoard(escrow())
      for (const v of Object.values(board)) {
        console.log([memoToRef(v.id).padEnd(16), v.status.padEnd(10), v.amount !== undefined ? formatUnits(v.amount, 6).padStart(10) : '', v.recipient ?? ''].join('  '))
      }
      break
    }
    default:
      console.log('commands: deploy | batch <winners.csv> [--days N] | clear <REF> [--paperwork "..."] | status | reclaim <REF>')
  }
}

main().catch((e) => {
  console.error((e as Error).message.split('\n')[0])
  process.exit(1)
})
