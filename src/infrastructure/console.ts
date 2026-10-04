/**
 * Organizer console — runs only on the organizer's machine with the organizer key.
 * Loopback + Host allow-list + same-origin + a per-start session token (printed once, kept in the URL fragment).
 *   npm run console → http://localhost:5175/#token=…
 */
import { createServer } from 'node:http'
import { randomBytes } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { privateKeyToAccount } from 'viem/accounts'
import { tempoClient, TempoEscrow, viemClaimKeys, ZERO, explainRevert } from '../adapters/tempoEscrow'
import { statusBoard } from '../application/payouts'
import { memoToRef, awardMemo } from '../domain/memo'
import { describe } from '../domain/status'
import { encodeClaimLink } from '../domain/claimLink'
import { recordPaperwork } from './paperwork'
import { submissionsByRef, bindingCheck, recordHash } from './paperworkInbox'
import { send, json, body, consoleAllowed } from './http'
import { CHAIN, EXPLORER, requireEnv, readEnv } from './config'
import type { Hex } from '../application/ports'

const PORT = Number(process.env.CONSOLE_PORT ?? 5175)
const TOKEN = randomBytes(18).toString('base64url')
const organizer = privateKeyToAccount(requireEnv('ORGANIZER_KEY_TESTNET') as Hex)
const ESCROW = requireEnv('ESCROW') as Hex
const PROGRAM = readEnv().PROGRAM_NAME ?? 'Crypto Builders Prize (demo)'
const escrow = new TempoEscrow(tempoClient(CHAIN, organizer), ESCROW, BigInt(requireEnv('ESCROW_BLOCK')))
const css = readFileSync('web/style.css', 'utf8')

const linkFiles = () => (existsSync('batches') ? readdirSync('batches').filter((f) => f.endsWith('.links.json')).map((f) => join('batches', f)) : [])
const allLinks = () => linkFiles().flatMap((f) => (JSON.parse(readFileSync(f, 'utf8')) as { ref: string; label: string; amount: string; link: string }[]).map((r) => ({ ...r, file: f })))

async function board() {
  const b = await statusBoard(escrow)
  const inbox = submissionsByRef()
  return Object.values(b).map((v) => {
    const ref = memoToRef(v.id)
    const subs = inbox[ref] ?? []
    const check = bindingCheck(v.registered, subs)
    const paperwork = check.forRegistered ?? subs[subs.length - 1] ?? null
    return { ...v, ref, says: describe(v).organizer, tone: describe(v).tone, paperwork, binding: check.binding, conflicts: check.others.length }
  })
}

createServer(async (req, res) => {
  try {
    const path = new URL(req.url ?? '/', 'http://x').pathname
    if (req.method === 'GET' && path === '/') return send(res, 200, 'text/html; charset=utf-8', readFileSync('web/ops.html', 'utf8').replace('/*css*/', css))
    if (!path.startsWith('/api/')) return send(res, 404, 'text/plain', 'not found')
    if (!consoleAllowed(req, PORT, TOKEN)) return json(res, 403, { error: 'organizer console: local only, open the URL printed at start' })

    if (req.method === 'GET' && path === '/api/status') return json(res, 200, { program: PROGRAM, escrow: ESCROW, explorer: EXPLORER, chainId: CHAIN.id, rows: await board() })

    if (req.method === 'POST' && path === '/api/clear') {
      // { items: [{ ref, expectedRecipient, note?, withholdBps? }] } — several awards → one transaction.
      // expectedRecipient comes from the paperwork (inbox or pasted by the organizer), never from chain state.
      const { items } = JSON.parse(await body(req)) as { items: { ref: string; expectedRecipient?: string; note?: string; withholdBps?: number; bearer?: boolean; overrideConflicts?: string }[] }
      const rows = await board()
      const planned = items.map((i) => {
        const row = rows.find((r) => r.ref === i.ref)
        if (!row) throw new Error(`unknown award ${i.ref}`)
        const withheld = i.withholdBps ? ((row.amount ?? 0n) * BigInt(i.withholdBps)) / 10_000n : 0n
        if (i.bearer) {
          recordPaperwork(i.ref, ZERO, `bearer claim opened by the organizer | ${i.note ?? ''}`)
          return { id: awardMemo(i.ref), recordHash: ('0x' + '00'.repeat(32)) as Hex, expectedRecipient: ZERO as Hex, withheld, winnerSignature: '0x' as Hex }
        }
        // server-side, per award (also inside a batch): the winner's own signed paperwork must name exactly this account
        const p = row.paperwork
        if (row.binding !== 'match' || !p || p.address.toLowerCase() !== String(i.expectedRecipient ?? '').toLowerCase()) {
          throw new Error(`${i.ref}: no signed paperwork from the registered account ${i.expectedRecipient ?? ''} — nothing was cleared`)
        }
        if (row.conflicts > 0 && !(i.overrideConflicts && i.overrideConflicts.trim().length >= 10)) {
          throw new Error(`${i.ref}: ${row.conflicts} other account(s) also filed paperwork for this award — check identities, then clear with a written reason (or issue a new link)`)
        }
        recordPaperwork(i.ref, p.address, [`winner paperwork ${p.at}: ${p.legalName}, ${p.taxCountry}`, i.note ?? '', i.overrideConflicts ? `conflict override: ${i.overrideConflicts}` : ''].filter(Boolean).join(' | '))
        return { id: awardMemo(i.ref), recordHash: recordHash(p), expectedRecipient: p.address as Hex, withheld, winnerSignature: p.signature as Hex }
      })
      const tx = planned.length === 1 ? await escrow.clear(planned[0].id, planned[0].recordHash, planned[0].expectedRecipient, planned[0].withheld, planned[0].winnerSignature) : await escrow.clearMany(planned)
      return json(res, 200, { tx: tx.hash, cleared: items.map((i) => i.ref) })
    }
    if (req.method === 'POST' && path === '/api/revoke') {
      const { ref } = JSON.parse(await body(req))
      return json(res, 200, { tx: (await escrow.revoke(awardMemo(ref))).hash })
    }
    if (req.method === 'POST' && path === '/api/reissue') {
      // new link key; the old link and any registration made with it stop working
      const { ref } = JSON.parse(await body(req))
      const row = (await board()).find((r) => r.ref === ref)
      // a registered award needs notice: the first call schedules (same key reused), a later call executes
      const pendingFile = 'paperwork/pending-links.json'
      const pending: Record<string, Hex> = existsSync(pendingFile) ? JSON.parse(readFileSync(pendingFile, 'utf8')) : {}
      const k = pending[ref] ? { privateKey: pending[ref], address: privateKeyToAccount(pending[ref]).address } : viemClaimKeys.create()
      const tx = await escrow.reissueLink(awardMemo(ref), k.address)
      const after = (await board()).find((r) => r.ref === ref)
      if (row?.status === 'Registered' && after?.status === 'Registered') {
        pending[ref] = k.privateKey
        writeFileSync(pendingFile, JSON.stringify(pending), { mode: 0o600 })
        return json(res, 200, { tx: tx.hash, scheduled: true, notBefore: after.reissueAt })
      }
      delete pending[ref]
      writeFileSync(pendingFile, JSON.stringify(pending), { mode: 0o600 })
      const old = allLinks().find((l) => l.ref === ref)
      const base = old ? old.link.slice(0, old.link.indexOf('/claim#')) : 'http://localhost:5174'
      const link = encodeClaimLink(base, { chainId: CHAIN.id, escrow: ESCROW, ref, claimKey: k.privateKey })
      if (old) {
        const list = JSON.parse(readFileSync(old.file, 'utf8')) as { ref: string; link: string }[]
        writeFileSync(old.file, JSON.stringify(list.map((l) => (l.ref === ref ? { ...l, link } : l)), null, 2))
      }
      return json(res, 200, { tx: tx.hash, link })
    }
    if (req.method === 'GET' && path === '/api/verify') {
      const ref = new URL(req.url ?? '', 'http://x').searchParams.get('ref') ?? ''
      const row = (await board()).find((r) => r.ref === ref)
      // the on-chain record hash is the hash of the winner's signed paperwork: find it in the inbox
      const sub = (submissionsByRef()[ref] ?? []).find((x) => row?.paperworkHash && recordHash(x).toLowerCase() === row.paperworkHash.toLowerCase())
      return json(res, 200, { ref, onchain: row?.paperworkHash ?? null, matches: !!sub, record: sub ? { at: sub.at, paperwork: `${sub.legalName} (${sub.taxCountry}), signed by ${sub.address}` } : null })
    }
    if (req.method === 'GET' && path === '/api/links.csv') {
      const csv = ['ref,label,amount,link', ...allLinks().map((r) => [r.ref, `"${r.label.replace(/"/g, '""')}"`, r.amount, r.link].join(','))].join('\n')
      return send(res, 200, 'text/csv', csv, { 'content-disposition': 'attachment; filename="claim-links.csv"' })
    }
    json(res, 404, { error: 'unknown endpoint' })
  } catch (e) {
    json(res, 500, { error: explainRevert(e) })
  }
}).listen(PORT, '127.0.0.1', () => {
  console.log(`organizer console: http://localhost:${PORT}/#token=${TOKEN}   (organizer ${organizer.address}, escrow ${ESCROW}, pid ${process.pid})`)
})
