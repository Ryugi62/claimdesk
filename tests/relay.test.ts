import { describe, it, expect } from 'vitest'
import { sponsorable, sponsorPolicy, rateLimiter, awardIdOf, CLAIM_SELECTOR, REGISTER_SELECTOR } from '../src/infrastructure/relay'

const ESCROW = '0x673e4e017342d1deb8bc8701ba160d64e66352ed' as const
const OTHER = '0x' + '11'.repeat(20)
describe('sponsorship policy', () => {
  const ok = (tx: Parameters<typeof sponsorable>[1]) => sponsorable([ESCROW], tx)
  it('sponsors one claim() or register() call into our escrow', () => {
    expect(ok({ calls: [{ to: ESCROW.toUpperCase().replace('0X', '0x'), data: CLAIM_SELECTOR + '00' }] })).toBe(true)
    expect(ok({ calls: [{ to: ESCROW, data: REGISTER_SELECTOR + '00' }], gas: 900_000n })).toBe(true)
  })
  it('refuses other contracts, other functions, batches and empty calls', () => {
    expect(ok({ calls: [{ to: OTHER, data: CLAIM_SELECTOR }] })).toBe(false)
    expect(ok({ calls: [{ to: ESCROW, data: '0xa9059cbb' }] })).toBe(false)
    expect(ok({ calls: [{ to: ESCROW, data: CLAIM_SELECTOR }, { to: ESCROW, data: CLAIM_SELECTOR }] })).toBe(false)
    expect(ok({ calls: [] })).toBe(false)
  })
  it('refuses inflated gas and account-key side effects', () => {
    expect(ok({ calls: [{ to: ESCROW, data: CLAIM_SELECTOR }], gas: 5_000_000n })).toBe(false)
    expect(ok({ calls: [{ to: ESCROW, data: CLAIM_SELECTOR }], keyAuthorization: { any: 1 } })).toBe(false)
    expect(ok({ calls: [{ to: ESCROW, data: CLAIM_SELECTOR }], aaAuthorizationList: [{}] })).toBe(false)
  })
})

describe('sponsorship policy — fees and tokens', () => {
  it('refuses inflated fee caps and unexpected fee tokens', () => {
    const base = { calls: [{ to: ESCROW, data: CLAIM_SELECTOR }] }
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
    expect(await sponsorPolicy(okClient, [ESCROW])({ from: OTHER, calls: [{ to: ESCROW, data }] })).toBe(true)
    expect(await sponsorPolicy(revertClient, [ESCROW])({ from: OTHER, calls: [{ to: ESCROW, data }] })).toBe(false)
    expect(await sponsorPolicy(okClient, [ESCROW])({ calls: [{ to: ESCROW, data }] })).toBe(false) // no sender
  })
  it('caps sponsored calls per award', async () => {
    const perAward = rateLimiter(2, 60_000, () => 0)
    const p = sponsorPolicy(okClient, [ESCROW], { perAward })
    const req = { from: OTHER, calls: [{ to: ESCROW, data }] }
    expect([await p(req), await p(req), await p(req)]).toEqual([true, true, false])
    expect(awardIdOf(data)).toBe(id)
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
