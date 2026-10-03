/**
 * Claimdesk local server (testnet): claim page for winners, status page for the organizer, sponsoring relay.
 * Binds 127.0.0.1 only.  npm run serve  →  http://127.0.0.1:5174
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFileSync } from 'node:fs'
import { build } from 'esbuild'
import { privateKeyToAccount } from 'viem/accounts'
import { tempoClient, TempoEscrow, claimEscrowAbi } from '../adapters/tempoEscrow'
import { EcbRates } from '../adapters/ecbRates'
import { statusBoard, receiptFor } from '../application/payouts'
import { memoToRef, awardMemo } from '../domain/memo'
import { createSponsorRelay } from './relay'
import { CHAIN, EXPLORER, requireEnv, readEnv } from './config'
import type { Hex } from '../application/ports'

const PORT = Number(process.env.PORT ?? 5174)
const organizer = privateKeyToAccount(requireEnv('ORGANIZER_KEY_TESTNET') as Hex)
const ESCROW = requireEnv('ESCROW') as Hex
const PROGRAM = readEnv().PROGRAM_NAME ?? 'Crypto Builders Prize (demo)'
const org = tempoClient(CHAIN, organizer)
const escrow = new TempoEscrow(org, ESCROW, BigInt(requireEnv('ESCROW_BLOCK')))
const relay = createSponsorRelay(tempoClient(CHAIN) as never, organizer, [ESCROW])
const fx = new EcbRates()
const STATUS = ['None', 'Funded', 'Cleared', 'Claimed', 'Expired', 'Reclaimed'] as const

const bundle = (await build({ entryPoints: ['web/claim.ts'], bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', minify: true, define: { 'process.env.NODE_ENV': '"production"' } })).outputFiles[0].text

function send(res: ServerResponse, code: number, type: string, body: string) {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' })
  res.end(body)
}
const json = (res: ServerResponse, code: number, data: unknown) => send(res, code, 'application/json', JSON.stringify(data, (_, v) => (typeof v === 'bigint' ? v.toString() : v)))

async function body(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const c of req) chunks.push(c as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

// WebAuthn needs a domain origin: open http://localhost:PORT (not 127.0.0.1)
const css = readFileSync('web/style.css', 'utf8')
const html = (name: string) => readFileSync(`web/${name}`, 'utf8').replace('/*css*/', css)

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`)
    if (req.method === 'GET' && url.pathname === '/claim') return send(res, 200, 'text/html; charset=utf-8', html('claim.html'))
    if (req.method === 'GET' && url.pathname === '/claim.js') return send(res, 200, 'text/javascript', bundle)
    if (req.method === 'GET' && url.pathname === '/') return send(res, 200, 'text/html; charset=utf-8', html('ops.html'))
    if (req.method === 'GET' && url.pathname === '/api/config') return json(res, 200, { chainId: CHAIN.id, rpc: CHAIN.rpcUrls.default.http[0], escrow: ESCROW, program: PROGRAM, explorer: EXPLORER, organizer: organizer.address })
    if (req.method === 'GET' && url.pathname === '/api/award') {
      const ref = url.searchParams.get('ref') ?? ''
      const id = awardMemo(ref)
      const a = (await org.readContract({ address: ESCROW, abi: claimEscrowAbi, functionName: 'awardOf', args: [id] })) as { token: Hex; amount: bigint; expiresAt: bigint; memo: Hex }
      const status = STATUS[Number(await org.readContract({ address: ESCROW, abi: claimEscrowAbi, functionName: 'statusOf', args: [id] }))]
      return json(res, 200, { ref, id, status, amount: a.amount, decimals: 6, symbol: 'pathUSD', expiresAt: Number(a.expiresAt), program: PROGRAM })
    }
    if (req.method === 'GET' && url.pathname === '/api/status') {
      const board = await statusBoard(escrow)
      return json(res, 200, Object.values(board).map((v) => ({ ...v, ref: memoToRef(v.id) })))
    }
    if (req.method === 'GET' && url.pathname === '/api/receipt') {
      const ref = url.searchParams.get('ref') ?? ''
      const hash = url.searchParams.get('tx') as Hex
      const currency = url.searchParams.get('currency') ?? undefined
      const r = await org.getTransactionReceipt({ hash })
      const block = await org.getBlock({ blockNumber: r.blockNumber })
      const ev = (await escrow.events()).find((e) => e.kind === 'Claimed' && e.txHash?.toLowerCase() === hash.toLowerCase())
      if (!ev || ev.kind !== 'Claimed' || memoToRef(ev.id) !== ref) return json(res, 404, { error: 'no claim for this award in that transaction' })
      const funded = (await escrow.events()).find((e) => e.kind === 'Funded' && e.id === ev.id)
      const amount = funded && funded.kind === 'Funded' ? funded.amount : 0n
      const receipt = await receiptFor({ ref, amount, decimals: 6, symbol: 'pathUSD', tx: { hash, blockTime: new Date(Number(block.timestamp) * 1000) }, memo: ev.id as Hex, recipient: ev.recipient as Hex }, fx, currency)
      return json(res, 200, { ...receipt, explorer: `${EXPLORER}/tx/${hash}`, program: PROGRAM })
    }
    if (req.method === 'POST' && url.pathname === '/relay') {
      const request = new Request(`http://127.0.0.1:${PORT}/relay`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: await body(req) })
      const out = await (relay as unknown as { fetch: (r: Request) => Promise<Response> }).fetch(request)
      return send(res, out.status, 'application/json', await out.text())
    }
    send(res, 404, 'text/plain', 'not found')
  } catch (e) {
    json(res, 500, { error: (e as Error).message.split('\n')[0] })
  }
}).listen(PORT, '127.0.0.1', () => console.log(`claimdesk on http://127.0.0.1:${PORT}  escrow ${ESCROW}  pid ${process.pid}`))
