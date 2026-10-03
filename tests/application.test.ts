import { describe, it, expect } from 'vitest'
import { createBatch, fundBatch, claimAward, statusBoard, receiptFor } from '../src/application/payouts'
import type { ClaimKeys, ClaimSubmitter, EscrowGateway, Hex, NewAward } from '../src/application/ports'
import type { EscrowEvent } from '../src/domain/status'

const ESCROW = ('0x' + '22'.repeat(20)) as Hex
let n = 0
const fakeKeys: ClaimKeys = {
  create: () => { n++; return { privateKey: ('0x' + n.toString(16).padStart(64, '0')) as Hex, address: ('0x' + n.toString(16).padStart(40, '0')) as Hex } },
  signClaim: async ({ claimKey, recipient }) => (`0xsig:${claimKey.slice(-2)}:${recipient}`) as Hex,
}
const tx = (h: string) => ({ hash: h as Hex, blockTime: new Date('2026-10-05T00:00:00Z') })

class FakeEscrow implements EscrowGateway {
  address = ESCROW; chainId = 42431; log: EscrowEvent[] = []; now = 0
  async fund(a: NewAward) { this.log.push({ kind: 'Funded', id: a.id, amount: a.amount, expiresAt: a.expiresAt }); return tx('0xf') }
  async clear(id: Hex) { this.log.push({ kind: 'Cleared', id }); return tx('0xc') }
  async reclaim(id: Hex) { this.log.push({ kind: 'Reclaimed', id }); return tx('0xr') }
  async events() { return this.log }
  async chainTime() { return this.now }
}

describe('payout flow with fakes (no network)', () => {
  it('creates one distinct link per winner and funds each award', async () => {
    const escrow = new FakeEscrow()
    const plan = createBatch([{ ref: 'WF-01', amount: 5n, label: 'A' }, { ref: 'WF-02', amount: 7n, label: 'B' }], fakeKeys, { baseUrl: 'https://c.example', escrow: ESCROW, chainId: 42431 })
    expect(new Set(plan.map((p) => p.link)).size).toBe(2)
    expect(plan[0].link).toContain('#v1.42431.')
    await fundBatch(plan, escrow, ('0x' + '20c0'.padEnd(40, '0')) as Hex, 100)
    const board = await statusBoard(escrow)
    expect(Object.values(board).map((v) => v.status)).toEqual(['Funded', 'Funded'])
  })

  it('claims with the key from the link and the winner as recipient', async () => {
    const plan = createBatch([{ ref: 'WF-03', amount: 5n, label: 'C' }], fakeKeys, { baseUrl: 'https://c.example', escrow: ESCROW, chainId: 42431 })
    const seen: unknown[] = []
    const submitter: ClaimSubmitter = { submit: async (a) => { seen.push(a); return tx('0xclaim') } }
    const winner = ('0x' + '33'.repeat(20)) as Hex
    const r = await claimAward(plan[0].link, winner, fakeKeys, submitter, { chainId: 42431 })
    expect(r.hash).toBe('0xclaim')
    expect(seen[0]).toMatchObject({ escrow: ESCROW, id: plan[0].id, recipient: winner, signature: `0xsig:${plan[0].claimKey.slice(-2)}:${winner}` })
  })

  it('refuses a link for another chain', async () => {
    const plan = createBatch([{ ref: 'WF-04', amount: 5n, label: 'D' }], fakeKeys, { baseUrl: 'https://c.example', escrow: ESCROW, chainId: 4217 })
    await expect(claimAward(plan[0].link, ESCROW, fakeKeys, { submit: async () => tx('0x') }, { chainId: 42431 })).rejects.toThrow(/chain 4217/)
  })

  it('builds a receipt in USD without a rate and in KRW with one', async () => {
    const pay = { ref: 'WF-01', amount: 1_500_000n, decimals: 6, symbol: 'pathUSD', tx: tx('0xp'), memo: ('0x' + '57'.padEnd(64, '0')) as Hex, recipient: ESCROW }
    expect((await receiptFor(pay, undefined, undefined)).local).toBeUndefined()
    const fx = { usdTo: async (c: string, d: string) => ({ currency: c, rate: 1400, rateDate: d, source: 'test' }) }
    expect((await receiptFor(pay, fx, 'KRW')).local?.amountText).toBe('2,100.00')
  })
})

describe('architecture', () => {
  it('domain and application import no adapters, infrastructure or SDKs', async () => {
    const { readdirSync, readFileSync } = await import('node:fs')
    for (const dir of ['src/domain', 'src/application']) {
      for (const f of readdirSync(dir)) {
        const text = readFileSync(`${dir}/${f}`, 'utf8')
        expect(text, `${dir}/${f}`).not.toMatch(/from ['"](viem|node:|\.\.\/adapters|\.\.\/infrastructure)/)
      }
    }
  })
})
