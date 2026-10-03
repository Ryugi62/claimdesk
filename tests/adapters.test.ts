import { describe, it, expect } from 'vitest'
import { EcbRates } from '../src/adapters/ecbRates'
import { viemClaimKeys, claimDigestInner } from '../src/adapters/tempoEscrow'
import { recoverMessageAddress } from 'viem'

describe('EcbRates (contract test with a fake server)', () => {
  it('asks for the date and returns the publication date it got', async () => {
    let url = ''
    const fake = (async (u: string) => { url = u; return new Response(JSON.stringify({ amount: 1, base: 'USD', date: '2026-10-02', rates: { KRW: 1391.25 } })) }) as unknown as typeof fetch
    const q = await new EcbRates(fake).usdTo('KRW', '2026-10-04')
    expect(url).toBe('https://api.frankfurter.dev/v1/2026-10-04?from=USD&to=KRW')
    expect(q).toMatchObject({ currency: 'KRW', rate: 1391.25, rateDate: '2026-10-02' })
  })
  it('fails loudly when the currency is missing', async () => {
    const fake = (async () => new Response(JSON.stringify({ date: '2026-10-02', rates: {} }))) as unknown as typeof fetch
    await expect(new EcbRates(fake).usdTo('XYZ', '2026-10-04')).rejects.toThrow(/XYZ/)
  })
})

describe('claim keys', () => {
  const k = viemClaimKeys.create()
  const base = { claimKey: k.privateKey, escrow: ('0x' + '11'.repeat(20)) as `0x${string}`, chainId: 42431, id: ('0x' + 'aa'.repeat(32)) as `0x${string}`, recipient: ('0x' + '22'.repeat(20)) as `0x${string}` }
  it('signs the digest the escrow recovers (EIP-191 over tag, escrow, chain, id, recipient)', async () => {
    const sig = await viemClaimKeys.sign({ purpose: 'claim', ...base })
    const inner = claimDigestInner('claim', base.escrow, 42431, base.id, base.recipient)
    expect(await recoverMessageAddress({ message: { raw: inner }, signature: sig })).toBe(k.address)
  })
  it('keeps claim and register signatures apart (domain tag)', () => {
    expect(claimDigestInner('claim', base.escrow, 42431, base.id, base.recipient)).not.toBe(claimDigestInner('register', base.escrow, 42431, base.id, base.recipient))
  })
})
