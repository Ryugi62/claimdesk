import { describe, it, expect } from 'vitest'
import { awardMemo, memoToRef } from '../src/domain/memo'
import { encodeClaimLink, parseClaimLink, isKnownEscrow } from '../src/domain/claimLink'
import { parseWinners } from '../src/domain/award'
import { reconcile, describe as describeStatus } from '../src/domain/status'
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
  it('round-trips every printable ASCII reference, including dots', () => {
    for (let c = 0x20; c <= 0x7e; c++) {
      const ref = `GRANT-v1.2${String.fromCharCode(c)}`
      const l = encodeClaimLink('https://c.example', { chainId: 1, escrow: ESCROW, ref, claimKey: KEY })
      expect(parseClaimLink(l).ref).toBe(ref)
    }
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
  it('registration is its own state; clearance then pays that account; reissue wipes it', () => {
    const ev = [{ kind: 'Funded' as const, id: memo, amount: 5n, expiresAt: 100 }, { kind: 'Registered' as const, id: memo, recipient: '0xw' }]
    expect(reconcile(ev, 10)[memo]).toMatchObject({ status: 'Registered', registered: '0xw' })
    expect(reconcile([...ev, { kind: 'LinkReissued' as const, id: memo }], 10)[memo]).toMatchObject({ status: 'Funded', registered: undefined })
    expect(reconcile([...ev, { kind: 'RecipientChanged' as const, id: memo, recipient: '0xcold' }], 10)[memo]).toMatchObject({ status: 'Registered', registered: '0xcold' })
    const paid = reconcile([...ev, { kind: 'Cleared' as const, id: memo }, { kind: 'Claimed' as const, id: memo, recipient: '0xw' }], 10)[memo]
    expect(paid).toMatchObject({ status: 'Claimed', recipient: '0xw' })
  })
  it('revoke is final and only before clearance', () => {
    const f = { kind: 'Funded' as const, id: memo, amount: 5n, expiresAt: 100 }
    expect(reconcile([f, { kind: 'Revoked' as const, id: memo }], 200)[memo].status).toBe('Revoked')
    expect(reconcile([f, { kind: 'Cleared' as const, id: memo }, { kind: 'Revoked' as const, id: memo }], 10)[memo].status).toBe('Inconsistent')
  })
  it('flags impossible histories instead of hiding them', () => {
    const r = reconcile([{ kind: 'Claimed' as const, id: memo, recipient: '0xabc' }], 0)[memo]
    expect(r.status).toBe('Inconsistent')
  })
})

describe('status copy', () => {
  it('tells a registered winner they will be paid automatically', () => {
    expect(describeStatus({ status: 'Registered' }).winner).toMatch(/automatically/)
    expect(describeStatus({ status: 'Registered' }).tone).toBe('ok')
    expect(describeStatus({ status: 'Funded' }).winner).toMatch(/Create your account/)
  })
})

describe('AC-8 receipt', () => {
  it('converts to local currency with the dated reference rate', () => {
    const r = buildReceipt({
      ref: 'WF-01', amount: 10_000_000_000n, decimals: 6, symbol: 'pathUSD', txHash: '0xtx', blockTime: new Date('2026-10-05T03:00:00Z'), memo: awardMemo('WF-01'), recipient: '0xr',
    }, { currency: 'KRW', rate: 1391.25, rateDate: '2026-10-02', source: 'ECB reference rate via frankfurter.app' })
    expect(r.amountText).toBe('10,000.00')
    expect(r.local).toEqual({ currency: 'KRW', rate: 1391.25, rateDate: '2026-10-02', source: 'ECB reference rate via frankfurter.app', amountText: '13,912,500' })
  })
  it('refuses a rate dated after the payment', () => {
    expect(() => buildReceipt({ ref: 'A', amount: 1n, decimals: 6, symbol: 'x', txHash: '0x', blockTime: new Date('2026-10-01T00:00:00Z'), memo: awardMemo('A'), recipient: '0x' },
      { currency: 'KRW', rate: 1, rateDate: '2026-10-02', source: 's' })).toThrow(/after/)
  })
  it('shows gross and withheld when tax was withheld at source', () => {
    const r = buildReceipt({ ref: 'A', amount: 7_000_000n, decimals: 6, symbol: 'x', txHash: '0x', blockTime: new Date('2026-10-05T00:00:00Z'), memo: awardMemo('A'), recipient: '0x', withheld: 3_000_000n })
    expect(r.amountText).toBe('7.00')
    expect(r.withholding).toEqual({ grossText: '10.00', withheldText: '3.00' })
  })
  it('uses two decimals for currencies with minor units', () => {
    const r = buildReceipt({ ref: 'A', amount: 1_000_000n, decimals: 6, symbol: 'x', txHash: '0x', blockTime: new Date('2026-10-05T00:00:00Z'), memo: awardMemo('A'), recipient: '0x' },
      { currency: 'EUR', rate: 0.8526, rateDate: '2026-10-02', source: 's' })
    expect(r.local?.amountText).toBe('0.85')
  })
  it('formats base units exactly', () => {
    expect(formatUnits(1_234_567n, 6)).toBe('1.234567')
    expect(formatUnits(1_000_000n, 6)).toBe('1')
  })
})

describe('claim page escrow allowlist', () => {
  const known = '0xc7022cb5e060daca0d6235aec384b57d3919682e'
  it('serves a configured escrow, in any letter case', () => {
    expect(isKnownEscrow({ [known]: 1 }, known)).toBe(true)
    expect(isKnownEscrow({ [known]: 1 }, '0xC7022CB5E060DACA0D6235AEC384B57D3919682E')).toBe(true)
  })
  it('refuses a look-alike escrow, a malformed address, and a page with no programs configured', () => {
    expect(isKnownEscrow({ [known]: 1 }, '0x' + '11'.repeat(20))).toBe(false)
    expect(isKnownEscrow({ [known]: 1 }, 'constructor')).toBe(false)
    expect(isKnownEscrow({}, known)).toBe(false)
    expect(isKnownEscrow(undefined, known)).toBe(false)
  })
})
