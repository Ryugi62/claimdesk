import { describe, it, expect } from 'vitest'
import { sponsorable, rateLimiter, CLAIM_SELECTOR, REGISTER_SELECTOR } from '../src/infrastructure/relay'

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

describe('rate limiter', () => {
  it('allows N per window per key', () => {
    let t = 0
    const allow = rateLimiter(2, 1000, () => t)
    expect([allow('ip'), allow('ip'), allow('ip')]).toEqual([true, true, false])
    expect(allow('other')).toBe(true)
    t = 1500
    expect(allow('ip')).toBe(true)
  })
})
