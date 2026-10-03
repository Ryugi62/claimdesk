import { describe, it, expect } from 'vitest'
import { consoleAllowed } from '../src/infrastructure/http'

const req = (o: { ip?: string; host?: string; origin?: string; token?: string }) => ({
  socket: { remoteAddress: o.ip ?? '127.0.0.1' },
  headers: { host: o.host ?? 'localhost:5175', origin: o.origin, 'x-console-token': o.token ?? 't0k' },
}) as never

describe('organizer console guard', () => {
  it('allows the local console with its token', () => {
    expect(consoleAllowed(req({}), 5175, 't0k')).toBe(true)
  })
  it('blocks DNS rebinding (foreign Host), cross-origin, remote sockets and missing tokens', () => {
    expect(consoleAllowed(req({ host: 'evil.example:5175' }), 5175, 't0k')).toBe(false)
    expect(consoleAllowed(req({ origin: 'https://evil.example' }), 5175, 't0k')).toBe(false)
    expect(consoleAllowed(req({ ip: '203.0.113.9' }), 5175, 't0k')).toBe(false)
    expect(consoleAllowed(req({ token: 'nope' }), 5175, 't0k')).toBe(false)
  })
})
