/**
 * Winner-facing server: claim + account pages and the sponsoring relay.
 * Holds ONLY the fee-payer key (small float) — never the organizer key.
 *   npm run relay   → http://localhost:5174   (HOST=0.0.0.0 to expose behind TLS)
 */
import { createServer } from 'node:http'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, extname } from 'node:path'
import { http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { tempoClient } from '../adapters/tempoEscrow'
import { createSponsorRelay, rateLimiter } from './relay'
import { send, json, body } from './http'
import { CHAIN, PATH_USD, requireEnv, readEnv } from './config'
import type { Hex } from '../application/ports'

const PORT = Number(process.env.PORT ?? 5174)
const HOST = process.env.HOST ?? '127.0.0.1'
const feePayer = privateKeyToAccount(requireEnv('FEE_PAYER_KEY_TESTNET') as Hex)
const ESCROW = requireEnv('ESCROW') as Hex
const ESCROW_BLOCK = requireEnv('ESCROW_BLOCK')
const PROGRAM = readEnv().PROGRAM_NAME ?? 'Crypto Builders Prize (demo)'
const relay = createSponsorRelay(tempoClient(CHAIN, undefined, http()) as never, feePayer, [ESCROW], { feeTokens: [PATH_USD], name: PROGRAM }) as unknown as { fetch: (r: Request) => Promise<Response> }
const perIp = rateLimiter(30, 60_000)

const WEB = '.cache/web'
execFileSync('node', ['scripts/build.mjs', '--out', WEB, '--sponsor', '/relay', '--program', PROGRAM, '--escrow', `${ESCROW}:${ESCROW_BLOCK}`], { stdio: 'inherit' })
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' }

createServer(async (req, res) => {
  try {
    const path = new URL(req.url ?? '/', 'http://x').pathname
    if (req.method === 'POST' && path === '/relay') {
      if (!perIp(req.socket.remoteAddress ?? '?')) return json(res, 429, { error: 'too many requests' })
      const out = await relay.fetch(new Request('http://relay/relay', { method: 'POST', headers: { 'content-type': 'application/json' }, body: await body(req) }))
      return send(res, out.status, 'application/json', await out.text())
    }
    const file = join(WEB, path === '/' || path === '/account' ? 'account.html' : path === '/claim' ? 'claim.html' : path.replace(/^\/+/, ''))
    if (req.method === 'GET' && file.startsWith(WEB) && existsSync(file)) return send(res, 200, TYPES[extname(file)] ?? 'application/octet-stream', readFileSync(file))
    send(res, 404, 'text/plain', 'not found')
  } catch (e) {
    json(res, 500, { error: (e as Error).message.split('\n')[0] })
  }
}).listen(PORT, HOST, () => console.log(`claimdesk winner pages + relay on http://localhost:${PORT}  escrow ${ESCROW}  fee payer ${feePayer.address}  pid ${process.pid}`))
