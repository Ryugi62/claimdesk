import { describe, it, expect } from 'vitest'
import { onlyClaimsTo, CLAIM_SELECTOR } from '../src/infrastructure/relay'

const ESCROW = '0x673e4e017342d1deb8bc8701ba160d64e66352ed' as const
describe('sponsorship policy', () => {
  const ok = onlyClaimsTo([ESCROW])
  it('sponsors a claim() call to our escrow', () => {
    expect(ok({ calls: [{ to: ESCROW.toUpperCase().replace('0X', '0x'), data: CLAIM_SELECTOR + '00' }] })).toBe(true)
  })
  it('refuses other contracts, other functions and empty batches', () => {
    expect(ok({ calls: [{ to: '0x' + '11'.repeat(20), data: CLAIM_SELECTOR }] })).toBe(false)
    expect(ok({ calls: [{ to: ESCROW, data: '0xa9059cbb' }] })).toBe(false)
    expect(ok({ calls: [{ to: ESCROW, data: CLAIM_SELECTOR }, { to: '0x' + '11'.repeat(20), data: '0x' }] })).toBe(false)
    expect(ok({ calls: [] })).toBe(false)
  })
})
