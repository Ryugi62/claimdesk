import { describe, it, expect } from 'vitest'
import { awardMemo, memoToRef } from '../src/domain/memo'
import { encodeClaimLink, parseClaimLink } from '../src/domain/claimLink'
import { parseWinners } from '../src/domain/award'
import { reconcile } from '../src/domain/status'
import { buildReceipt, formatUnits } from '../src/domain/receipt'

const ESCROW = '0x1111111111111111111111111111111111111111'
const KEY = '0x' + 'ab'.repeat(32)

describe('AC-1 memo', () => {
  it('is 32 bytes, deterministic, and recoverable', () => {
    const m = awardMemo('WF-2026-TEMPO-03')
    expect(m).toMatch(/^0x[0-9a-f]{64}$/)
    expect(awardMemo('WF-2026-TEMPO-03')).toBe(m)
    expect(memoToRef(m)).toBe('WF-2026-TEMPO-03')
  })
  it('rejects references that cannot fit or are not printable ASCII', () => {
    expect(() => awardMemo('x'.repeat(32))).toThrow(/31/)
    expect(() => awardMemo('상금')).toThrow(/ASCII/)
    expect(() => awardMemo('')).toThrow()
  })
})

describe('AC-2 claim link', () => {
  const link = encodeClaimLink('https://claimdesk.example', { chainId: 42431, escrow: ESCROW, ref: 'WF-03', claimKey: KEY })
  it('keeps the key in the fragment and round-trips', () => {
    expect(link.split('#')[0]).not.toContain(KEY.slice(2))
    expect(parseClaimLink(link)).toEqual({ chainId: 42431, escrow: ESCROW, ref: 'WF-03', claimKey: KEY })
  })
  it('rejects a tampered link', () => {
    const tampered = link.replace('WF-03', 'WF-04')
    expect(() => parseClaimLink(tampered)).toThrow(/checksum/)
    expect(() => parseClaimLink('https://x/claim#nonsense')).toThrow()
  })
})

describe('winners list', () => {
  it('parses CSV rows into awards in base units', () => {
    const rows = parseWinners('ref,amount,label\nWF-01,10000,Team Alpha\nWF-02,15000.5,Bob\n', 6)
    expect(rows).toEqual([
      { ref: 'WF-01', amount: 10_000_000_000n, label: 'Team Alpha' },
      { ref: 'WF-02', amount: 15_000_500_000n, label: 'Bob' },
    ])
  })
  it('refuses duplicates, zero amounts and too many decimals', () => {
    expect(() => parseWinners('ref,amount,label\nA,1,x\nA,2,y', 6)).toThrow(/duplicate/)
    expect(() => parseWinners('ref,amount,label\nA,0,x', 6)).toThrow(/amount/)
    expect(() => parseWinners('ref,amount,label\nA,1.1234567,x', 6)).toThrow(/decimals/)
  })
})

describe('AC-9 reconcile', () => {
  const memo = awardMemo('WF-01')
  it('follows the state machine', () => {
    const base = [{ kind: 'Funded' as const, id: memo, amount: 5n, expiresAt: 100 }]
    expect(reconcile(base, 50)[memo].status).toBe('Funded')
    expect(reconcile([...base, { kind: 'Cleared' as const, id: memo }], 50)[memo].status).toBe('Cleared')
    expect(reconcile([...base, { kind: 'Cleared' as const, id: memo }], 150)[memo].status).toBe('Expired')
    const claimed = reconcile([...base, { kind: 'Cleared' as const, id: memo }, { kind: 'Claimed' as const, id: memo, recipient: '0xabc' }], 150)[memo]
    expect(claimed.status).toBe('Claimed')
    expect(claimed.recipient).toBe('0xabc')
    expect(reconcile([...base, { kind: 'Reclaimed' as const, id: memo }], 150)[memo].status).toBe('Reclaimed')
  })
  it('flags impossible histories instead of hiding them', () => {
    const r = reconcile([{ kind: 'Claimed' as const, id: memo, recipient: '0xabc' }], 0)[memo]
    expect(r.status).toBe('Inconsistent')
  })
})

describe('AC-8 receipt', () => {
  it('converts to local currency with the dated reference rate', () => {
    const r = buildReceipt({
      ref: 'WF-01', amount: 10_000_000_000n, decimals: 6, symbol: 'pathUSD', txHash: '0xtx', blockTime: new Date('2026-10-05T03:00:00Z'), memo: awardMemo('WF-01'), recipient: '0xr',
    }, { currency: 'KRW', rate: 1391.25, rateDate: '2026-10-02', source: 'ECB reference rate via frankfurter.app' })
    expect(r.amountText).toBe('10,000.00')
    expect(r.local).toEqual({ currency: 'KRW', rate: 1391.25, rateDate: '2026-10-02', source: 'ECB reference rate via frankfurter.app', amountText: '13,912,500.00' })
  })
  it('refuses a rate dated after the payment', () => {
    expect(() => buildReceipt({ ref: 'A', amount: 1n, decimals: 6, symbol: 'x', txHash: '0x', blockTime: new Date('2026-10-01T00:00:00Z'), memo: awardMemo('A'), recipient: '0x' },
      { currency: 'KRW', rate: 1, rateDate: '2026-10-02', source: 's' })).toThrow(/after/)
  })
  it('formats base units exactly', () => {
    expect(formatUnits(1_234_567n, 6)).toBe('1.234567')
    expect(formatUnits(1_000_000n, 6)).toBe('1')
  })
})
