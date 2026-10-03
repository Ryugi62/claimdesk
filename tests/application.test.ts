import { describe, it, expect } from 'vitest'
import { createBatch, fundBatch, claimAward, registerAccount, statusBoard, receiptFor } from '../src/application/payouts'
import type { ClaimKeys, EscrowGateway, Hex, NewAward, WinnerGateway } from '../src/application/ports'
import type { EscrowEvent } from '../src/domain/status'

const ESCROW = ('0x' + '22'.repeat(20)) as Hex
let n = 0
const fakeKeys: ClaimKeys = {
  create: () => { n++; return { privateKey: ('0x' + n.toString(16).padStart(64, '0')) as Hex, address: ('0x' + n.toString(16).padStart(40, '0')) as Hex } },
  sign: async ({ purpose, claimKey, recipient }) => (`0x${purpose}:${claimKey.slice(-2)}:${recipient}`) as Hex,
}
const tx = (h: string) => ({ hash: h as Hex, blockTime: new Date('2026-10-05T00:00:00Z') })

class FakeEscrow implements EscrowGateway {
  address = ESCROW; chainId = 42431; log: EscrowEvent[] = []; now = 0; batches = 0
  async fundMany(_t: Hex, awards: NewAward[]) { this.batches++; for (const a of awards) this.log.push({ kind: 'Funded', id: a.id, amount: a.amount, expiresAt: a.expiresAt }); return tx('0xf') }
  async clear(id: Hex) { this.log.push({ kind: 'Cleared', id }); return tx('0xc') }
  async clearMany(items: { id: Hex }[]) { for (const i of items) this.log.push({ kind: 'Cleared', id: i.id }); return tx('0xcm') }
  async reissueLink(id: Hex) { this.log.push({ kind: 'LinkReissued', id }); return tx('0xri') }
  async revoke(id: Hex) { this.log.push({ kind: 'Revoked', id }); return tx('0xv') }
  async reclaim(id: Hex) { this.log.push({ kind: 'Reclaimed', id }); return tx('0xr') }
  async events() { return this.log }
  async chainTime() { return this.now }
}
const winnerGw = (seen: unknown[]): WinnerGateway => ({
  register: async (a) => { seen.push(['register', a]); return tx('0xreg') },
  claim: async (a) => { seen.push(['claim', a]); return tx('0xclaim') },
})

describe('payout flow with fakes (no network)', () => {
  it('creates one distinct link per winner and funds the whole batch in one transaction', async () => {
    const escrow = new FakeEscrow()
    const plan = createBatch([{ ref: 'WF-01', amount: 5n, label: 'A' }, { ref: 'WF-02', amount: 7n, label: 'B' }], fakeKeys, { baseUrl: 'https://c.example', escrow: ESCROW, chainId: 42431 })
    expect(new Set(plan.map((p) => p.link)).size).toBe(2)
    await fundBatch(plan, escrow, ('0x' + '20c0'.padEnd(40, '0')) as Hex, 100)
    expect(escrow.batches).toBe(1)
    expect(Object.values(await statusBoard(escrow)).map((v) => v.status)).toEqual(['Funded', 'Funded'])
  })

  it('registers the winner account with a register-purpose signature', async () => {
    const plan = createBatch([{ ref: 'WF-05', amount: 5n, label: 'E' }], fakeKeys, { baseUrl: 'https://c.example', escrow: ESCROW, chainId: 42431 })
    const seen: unknown[] = []
    const me = ('0x' + '44'.repeat(20)) as Hex
    await registerAccount(plan[0].link, me, fakeKeys, winnerGw(seen), { chainId: 42431 })
    expect(seen[0]).toEqual(['register', { escrow: ESCROW, id: plan[0].id, recipient: me, signature: `0xregister:${plan[0].claimKey.slice(-2)}:${me}` }])
  })

  it('claims with a claim-purpose signature for the winner as recipient', async () => {
    const plan = createBatch([{ ref: 'WF-03', amount: 5n, label: 'C' }], fakeKeys, { baseUrl: 'https://c.example', escrow: ESCROW, chainId: 42431 })
    const seen: unknown[] = []
    const winner = ('0x' + '33'.repeat(20)) as Hex
    const r = await claimAward(plan[0].link, winner, fakeKeys, winnerGw(seen), { chainId: 42431 })
    expect(r.hash).toBe('0xclaim')
    expect(seen[0]).toEqual(['claim', { escrow: ESCROW, id: plan[0].id, recipient: winner, signature: `0xclaim:${plan[0].claimKey.slice(-2)}:${winner}` }])
  })

  it('refuses a link for another chain', async () => {
    const plan = createBatch([{ ref: 'WF-04', amount: 5n, label: 'D' }], fakeKeys, { baseUrl: 'https://c.example', escrow: ESCROW, chainId: 4217 })
    await expect(claimAward(plan[0].link, ESCROW, fakeKeys, winnerGw([]), { chainId: 42431 })).rejects.toThrow(/chain 4217/)
  })

  it('builds a receipt in USD without a rate, in KRW with one, and falls back to USD when the rate source fails', async () => {
    const pay = { ref: 'WF-01', amount: 1_500_000n, decimals: 6, symbol: 'pathUSD', tx: tx('0xp'), memo: ('0x' + '57'.padEnd(64, '0')) as Hex, recipient: ESCROW }
    expect((await receiptFor(pay, undefined, undefined)).local).toBeUndefined()
    const fx = { usdTo: async (c: string, d: string) => ({ currency: c, rate: 1400, rateDate: d, source: 'test' }) }
    expect((await receiptFor(pay, fx, 'KRW')).local?.amountText).toBe('2,100')
    const broken = { usdTo: async () => { throw new Error('no ECB rate for VND') } }
    const r = await receiptFor(pay, broken, 'VND')
    expect(r.local).toBeUndefined()
    expect(r.amountText).toBe('1.50')
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
