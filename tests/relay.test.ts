import { describe, it, expect } from 'vitest'
import { sponsorable, sponsorPolicy, rateLimiter, awardIdOf, relayMethodAllowed, clientIp, CLAIM_SELECTOR, REGISTER_SELECTOR } from '../src/infrastructure/relay'

const ESCROW = '0x673e4e017342d1deb8bc8701ba160d64e66352ed' as const
const NOW = Math.floor(Date.now() / 1000)
const caps = { gas: 300_000n, maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 0n, validBefore: NOW + 60 }
const OTHER = '0x' + '11'.repeat(20)
describe('sponsorship policy', () => {
  const ok = (tx: Parameters<typeof sponsorable>[1]) => sponsorable([ESCROW], tx)
  it('sponsors one claim() or register() call into our escrow', () => {
    expect(ok({ calls: [{ to: ESCROW.toUpperCase().replace('0X', '0x'), data: CLAIM_SELECTOR + '00' }], ...caps })).toBe(true)
    expect(ok({ calls: [{ to: ESCROW, data: REGISTER_SELECTOR + '00' }], ...caps, gas: 900_000n })).toBe(true)
  })
  it('requires gas, both fee caps and validBefore (a missing field is a refusal)', () => {
    const call = { calls: [{ to: ESCROW, data: CLAIM_SELECTOR }] }
    expect(ok({ ...call, ...caps })).toBe(true)
    for (const k of ['gas', 'maxFeePerGas', 'maxPriorityFeePerGas', 'validBefore'] as const) {
      const partial = { ...call, ...caps } as Record<string, unknown>
      delete partial[k]
      expect(ok(partial as never), k).toBe(false)
    }
  })
  it('refuses other contracts, other functions, batches and empty calls', () => {
    expect(ok({ calls: [{ to: OTHER, data: CLAIM_SELECTOR }] })).toBe(false)
    expect(ok({ calls: [{ to: ESCROW, data: '0xa9059cbb' }] })).toBe(false)
    expect(ok({ calls: [{ to: ESCROW, data: CLAIM_SELECTOR }, { to: ESCROW, data: CLAIM_SELECTOR }] })).toBe(false)
    expect(ok({ calls: [] })).toBe(false)
  })
  it('sponsors changeRecipient too, and refuses transactions that stay valid too long', () => {
    expect(ok({ calls: [{ to: ESCROW, data: '0x' + 'ab'.repeat(4) }], ...caps })).toBe(false)
    const now = 1_000_000
    expect(sponsorable([ESCROW], { calls: [{ to: ESCROW, data: CLAIM_SELECTOR }], ...caps, validBefore: now + 60 }, [], now)).toBe(true)
    expect(sponsorable([ESCROW], { calls: [{ to: ESCROW, data: CLAIM_SELECTOR }], ...caps, validBefore: now + 3_600 }, [], now)).toBe(false)
  })
  it('refuses inflated gas and account-key side effects', () => {
    expect(ok({ calls: [{ to: ESCROW, data: CLAIM_SELECTOR }], ...caps, gas: 5_000_000n })).toBe(false)
    expect(ok({ calls: [{ to: ESCROW, data: CLAIM_SELECTOR }], ...caps, keyAuthorization: { any: 1 } })).toBe(false)
    expect(ok({ calls: [{ to: ESCROW, data: CLAIM_SELECTOR }], ...caps, aaAuthorizationList: [{}] })).toBe(false)
  })
})

describe('sponsorship policy — fees and tokens', () => {
  it('refuses inflated fee caps and unexpected fee tokens', () => {
    const base = { calls: [{ to: ESCROW, data: CLAIM_SELECTOR }], ...caps }
    expect(sponsorable([ESCROW], { ...base, maxFeePerGas: 10n ** 12n })).toBe(false)
    expect(sponsorable([ESCROW], { ...base, maxPriorityFeePerGas: 10n ** 11n })).toBe(false)
    expect(sponsorable([ESCROW], { ...base, feeToken: OTHER }, ['0x20c0000000000000000000000000000000000000'])).toBe(false)
    expect(sponsorable([ESCROW], { ...base, feeToken: '0x20c0000000000000000000000000000000000000' }, ['0x20c0000000000000000000000000000000000000'])).toBe(true)
  })
})

describe('sponsorPolicy (async, with simulation and per-award limit)', () => {
  const id = '0x' + 'ab'.repeat(32)
  const data = CLAIM_SELECTOR + id.slice(2) + '00'.repeat(64)
  const okClient = { call: async () => '0x' }
  const revertClient = { call: async () => { throw new Error('execution reverted: WrongState') } }
  it('pays only when the exact call would succeed', async () => {
    expect(await sponsorPolicy(okClient, [ESCROW])({ from: OTHER, calls: [{ to: ESCROW, data }], ...caps })).toBe(true)
    expect(await sponsorPolicy(revertClient, [ESCROW])({ from: OTHER, calls: [{ to: ESCROW, data }], ...caps })).toBe(false)
    expect(await sponsorPolicy(okClient, [ESCROW])({ calls: [{ to: ESCROW, data }], ...caps })).toBe(false) // no sender
  })
  it('caps sponsored calls per award', async () => {
    const perAward = rateLimiter(2, 60_000, () => 0)
    const p = sponsorPolicy(okClient, [ESCROW], { perAward })
    const req = { from: OTHER, calls: [{ to: ESCROW, data }], ...caps }
    expect([await p(req), await p(req), await p(req)]).toEqual([true, true, false])
    expect(awardIdOf(data)).toBe(id)
  })
  it('junk calls that would revert do not use up a winner\'s quota', async () => {
    const perAward = rateLimiter(1, 60_000, () => 0)
    const junk = sponsorPolicy(revertClient, [ESCROW], { perAward })
    for (let i = 0; i < 10; i++) await junk({ from: OTHER, calls: [{ to: ESCROW, data }], ...caps })
    const real = sponsorPolicy(okClient, [ESCROW], { perAward })
    expect(await real({ from: OTHER, calls: [{ to: ESCROW, data }], ...caps })).toBe(true)
  })
})

describe('relay surface', () => {
  it('answers only the methods a sponsored send needs; never sign-without-broadcast', () => {
    expect(relayMethodAllowed({ method: 'eth_fillTransaction' })).toBe(true)
    expect(relayMethodAllowed([{ method: 'eth_chainId' }, { method: 'eth_sendRawTransactionSync' }])).toBe(true)
    expect(relayMethodAllowed({ method: 'eth_signRawTransaction' })).toBe(false)
    expect(relayMethodAllowed({ method: 'eth_getBalance' })).toBe(false)
    expect(relayMethodAllowed([])).toBe(false)
  })
  it('uses X-Forwarded-For only behind a trusted proxy', () => {
    expect(clientIp('10.0.0.1', '203.0.113.7, 10.0.0.1', true)).toBe('203.0.113.7')
    expect(clientIp('10.0.0.1', '203.0.113.7', false)).toBe('10.0.0.1')
  })
})

describe('rate limiter', () => {
  it('allows N per window per key', () => {
    let t = 0
    const allow = rateLimiter(2, 1000, () => t)
    expect([allow('ip'), allow('ip'), allow('ip')]).toEqual([true, true, false])
    expect(allow('other')).toBe(true)
    t = 1500
    expect(allow('ip')).toBe(true)
  })
  it('evicts stale keys once it grows past its bound', () => {
    let t = 0
    const allow = rateLimiter(1, 10, () => t, 3)
    for (const k of ['a', 'b', 'c', 'd']) allow(k)
    t = 100
    allow('e') // triggers eviction of a..d
    expect(allow('a')).toBe(true)
  })
})
