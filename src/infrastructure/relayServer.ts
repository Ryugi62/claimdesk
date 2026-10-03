/**
 * Winner-facing server: claim + account pages and the sponsoring relay.
 * Reads ONLY .env.relay (fee-payer key, escrow, block, program) — never the organizer key.
 *   npm run relay   → http://localhost:5174   (HOST=0.0.0.0 to expose behind TLS)
 */
import { createServer } from 'node:http'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, extname } from 'node:path'
import { http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { tempoClient, paperworkDigest, recoverTempoSigner } from '../adapters/tempoEscrow'
import { awardMemo } from '../domain/memo'
import { createSponsorRelay, rateLimiter, relayMethodAllowed, clientIp } from './relay'
import { submit, recordHash } from './paperworkInbox'
import { send, json, body } from './http'
import { CHAIN, PATH_USD, RELAY_ENV_FILE, readEnv, requireRelayEnv } from './config'
import type { Hex } from '../application/ports'

const PORT = Number(process.env.PORT ?? 5174)
const HOST = process.env.HOST ?? '127.0.0.1'
const feePayer = privateKeyToAccount(requireRelayEnv('FEE_PAYER_KEY_TESTNET') as Hex)
const ESCROW = requireRelayEnv('ESCROW') as Hex
const ESCROW_BLOCK = requireRelayEnv('ESCROW_BLOCK')
const PROGRAM = readEnv(RELAY_ENV_FILE).PROGRAM_NAME ?? 'Crypto Builders Prize (demo)'
const reader = tempoClient(CHAIN)
const relay = createSponsorRelay(tempoClient(CHAIN, undefined, http()) as never, feePayer, [ESCROW], { feeTokens: [PATH_USD], name: PROGRAM }) as unknown as { fetch: (r: Request) => Promise<Response> }
const perIp = rateLimiter(30, 60_000)
const perIpPaperwork = rateLimiter(10, 3_600_000)
const TRUST_PROXY = process.env.TRUST_PROXY === '1'

const WEB = '.cache/web'
execFileSync('node', ['scripts/build.mjs', '--out', WEB, '--sponsor', '/relay', '--program', PROGRAM, '--escrow', `${ESCROW}:${ESCROW_BLOCK}`], { stdio: 'inherit' })
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' }

createServer(async (req, res) => {
  try {
    const path = new URL(req.url ?? '/', 'http://x').pathname
    const ip = clientIp(req.socket.remoteAddress, req.headers['x-forwarded-for'], TRUST_PROXY)
    if (req.method === 'POST' && path === '/relay') {
      if (!perIp(ip)) return json(res, 429, { error: 'too many requests' })
      const raw = await body(req)
      let parsed: unknown
      try { parsed = JSON.parse(raw) } catch { return json(res, 400, { error: 'bad json' }) }
      if (!relayMethodAllowed(parsed)) {
        console.log('relay refused method(s):', JSON.stringify((Array.isArray(parsed) ? parsed : [parsed]).map((r) => (r as { method?: string }).method)))
        return json(res, 403, { error: 'method not offered by this relay' })
      }
      const out = await relay.fetch(new Request('http://relay/relay', { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw }))
      return send(res, out.status, 'application/json', await out.text())
    }
    if (req.method === 'POST' && path === '/api/paperwork') {
      // stand-in for the organizer's KYC / tax-form provider webhook: lands in the organizer's local inbox
      if (!perIpPaperwork(ip)) return json(res, 429, { error: 'too many submissions' })
      try {
        const s = await submit(
          JSON.parse(await body(req)),
          (f) => paperworkDigest(ESCROW, CHAIN.id, awardMemo(f.ref), f.address as Hex, recordHash(f)),
          (digest, signature) => recoverTempoSigner(reader, digest, signature),
        )
        return json(res, 200, { ok: true, ref: s.ref, address: s.address })
      } catch (e) {
        return json(res, 400, { error: (e as Error).message })
      }
    }
    const file = join(WEB, path === '/' || path === '/account' ? 'account.html' : path === '/claim' ? 'claim.html' : path === '/paperwork' ? 'paperwork.html' : path.replace(/^\/+/, ''))
    if (req.method === 'GET' && file.startsWith(WEB) && existsSync(file)) return send(res, 200, TYPES[extname(file)] ?? 'application/octet-stream', readFileSync(file))
    send(res, 404, 'text/plain', 'not found')
  } catch (e) {
    json(res, 500, { error: (e as Error).message.split('\n')[0] })
  }
}).listen(PORT, HOST, () => console.log(`claimdesk winner pages + relay on http://localhost:${PORT}  escrow ${ESCROW}  fee payer ${feePayer.address}  pid ${process.pid}`))
