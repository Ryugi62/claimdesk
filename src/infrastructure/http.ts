import type { IncomingMessage, ServerResponse } from 'node:http'

export function send(res: ServerResponse, code: number, type: string, body: string | Buffer, headers: Record<string, string> = {}) {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers })
  res.end(body)
}
export const json = (res: ServerResponse, code: number, data: unknown) =>
  send(res, code, 'application/json', JSON.stringify(data, (_, v) => (typeof v === 'bigint' ? v.toString() : v)))

export async function body(req: IncomingMessage, limit = 64_000): Promise<string> {
  const chunks: Buffer[] = []
  let n = 0
  for await (const c of req) {
    n += (c as Buffer).length
    if (n > limit) throw new Error('request too large')
    chunks.push(c as Buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/** Organizer console guard: loopback socket, Host allow-list (DNS-rebinding), same-origin, session token. */
export function consoleAllowed(req: IncomingMessage, port: number, token: string): boolean {
  const ip = req.socket.remoteAddress ?? ''
  const host = req.headers.host ?? ''
  const origin = req.headers.origin
  const loopback = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1'
  const hostOk = host === `localhost:${port}` || host === `127.0.0.1:${port}`
  const originOk = !origin || origin === `http://localhost:${port}` || origin === `http://127.0.0.1:${port}`
  return loopback && hostOk && originOk && req.headers['x-console-token'] === token
}
