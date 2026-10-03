/**
 * Claimdesk organizer server (runs on the organizer's machine, testnet):
 *  - winner pages (claim, account) with fees sponsored by the organizer's own relay (/relay)
 *  - organizer console (/): status from chain events, Clear / Revoke buttons, mail-merge export of claim links
 * Binds 127.0.0.1 only. WebAuthn needs a domain origin → open http://localhost:5174 (not 127.0.0.1).
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, extname } from 'node:path'
import { http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { keccak256, toHex } from 'viem'
import { tempoClient, TempoEscrow } from '../adapters/tempoEscrow'
import { statusBoard } from '../application/payouts'
import { memoToRef, awardMemo } from '../domain/memo'
import { describe } from '../domain/status'
import { createSponsorRelay, rateLimiter } from './relay'
import { CHAIN, EXPLORER, requireEnv, readEnv } from './config'
import type { Hex } from '../application/ports'

const PORT = Number(process.env.PORT ?? 5174)
const organizer = privateKeyToAccount(requireEnv('ORGANIZER_KEY_TESTNET') as Hex)
const feePayer = privateKeyToAccount(requireEnv('FEE_PAYER_KEY_TESTNET') as Hex)
const ESCROW = requireEnv('ESCROW') as Hex
const ESCROW_BLOCK = BigInt(requireEnv('ESCROW_BLOCK'))
const PROGRAM = readEnv().PROGRAM_NAME ?? 'Crypto Builders Prize (demo)'
const org = tempoClient(CHAIN, organizer)
const escrow = new TempoEscrow(org, ESCROW, ESCROW_BLOCK)
const relay = createSponsorRelay(tempoClient(CHAIN, undefined, http()) as never, feePayer, [ESCROW]) as unknown as { fetch: (r: Request) => Promise<Response> }
const perIp = rateLimiter(30, 60_000)

const WEB = '.cache/web'
execFileSync('node', ['scripts/build.mjs', '--out', WEB, '--sponsor', '/relay', '--program', PROGRAM, '--escrow', `${ESCROW}:${ESCROW_BLOCK}`], { stdio: 'inherit' })
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' }
const css = readFileSync('web/style.css', 'utf8')

function send(res: ServerResponse, code: number, type: string, body: string | Buffer) {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' })
  res.end(body)
}
const json = (res: ServerResponse, code: number, data: unknown) => send(res, code, 'application/json', JSON.stringify(data, (_, v) => (typeof v === 'bigint' ? v.toString() : v)))
async function body(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}
/** Organizer-only endpoints: same machine and same origin. */
function local(req: IncomingMessage): boolean {
  const ip = req.socket.remoteAddress ?? ''
  const origin = req.headers.origin
  return (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') && (!origin || /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin))
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)
    const path = url.pathname
    if (req.method === 'POST' && path === '/relay') {
      if (!perIp(req.socket.remoteAddress ?? '?')) return json(res, 429, { error: 'too many requests' })
      const out = await relay.fetch(new Request(`http://localhost:${PORT}/relay`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: await body(req) }))
      return send(res, out.status, 'application/json', await out.text())
    }
    if (req.method === 'GET' && path === '/') return send(res, 200, 'text/html; charset=utf-8', readFileSync('web/ops.html', 'utf8').replace('/*css*/', css))
    if (path.startsWith('/api/')) {
      if (!local(req)) return json(res, 403, { error: 'organizer console is local only' })
      if (req.method === 'GET' && path === '/api/status') {
        const board = await statusBoard(escrow)
        return json(res, 200, { program: PROGRAM, escrow: ESCROW, explorer: EXPLORER, chainId: CHAIN.id, rows: Object.values(board).map((v) => ({ ...v, ref: memoToRef(v.id), says: describe(v).organizer, tone: describe(v).tone })) })
      }
      if (req.method === 'POST' && path === '/api/clear') {
        const { ref, paperwork } = JSON.parse(await body(req))
        const hash = keccak256(toHex(JSON.stringify({ ref, paperwork, at: new Date().toISOString() })))
        const tx = await escrow.clear(awardMemo(ref), hash)
        return json(res, 200, { tx: tx.hash, paperworkHash: hash })
      }
      if (req.method === 'POST' && path === '/api/revoke') {
        const { ref } = JSON.parse(await body(req))
        return json(res, 200, { tx: (await escrow.revoke(awardMemo(ref))).hash })
      }
      if (req.method === 'GET' && path === '/api/links.csv') {
        const rows = existsSync('batches') ? readdirSync('batches').filter((f) => f.endsWith('.links.json')).flatMap((f) => JSON.parse(readFileSync(join('batches', f), 'utf8'))) : []
        const csv = ['ref,label,amount,link', ...rows.map((r: { ref: string; label: string; amount: string; link: string }) => [r.ref, `"${r.label.replace(/"/g, '""')}"`, r.amount, r.link].join(','))].join('\n')
        res.writeHead(200, { 'content-type': 'text/csv', 'content-disposition': 'attachment; filename="claim-links.csv"', 'cache-control': 'no-store' })
        return res.end(csv)
      }
      return json(res, 404, { error: 'unknown endpoint' })
    }
    const file = join(WEB, path === '/claim' ? 'claim.html' : path === '/account' ? 'account.html' : path.replace(/^\/+/, ''))
    if (req.method === 'GET' && file.startsWith(WEB) && existsSync(file)) return send(res, 200, TYPES[extname(file)] ?? 'application/octet-stream', readFileSync(file))
    send(res, 404, 'text/plain', 'not found')
  } catch (e) {
    json(res, 500, { error: (e as Error).message.split('\n')[0] })
  }
}).listen(PORT, '127.0.0.1', () => console.log(`claimdesk on http://localhost:${PORT}  escrow ${ESCROW}  fee payer ${feePayer.address}  pid ${process.pid}`))
