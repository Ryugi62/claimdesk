import { describe, it, expect } from 'vitest'
import { mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { submit, submissionsByRef, bindingCheck, validateFields, recordHash } from '../src/infrastructure/paperworkInbox'

const A = '0x846aAa3024e0f06A4a0B24151B9FCc57dcF38632'
const B = '0x000000000000000000000000000000000000bEEF'
const digest = (f: { ref: string; address: string }) => (('0x' + Buffer.from(f.ref + f.address.toLowerCase()).toString('hex').padEnd(64, '0').slice(0, 64)) as `0x${string}`)
// fake verifier: the "signature" is the signer's address
const recover = async (_d: `0x${string}`, sig: `0x${string}`) => sig

describe('paperwork inbox (KYC/tax-form stand-in, signed by the payout account)', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'cd-')), 'paperwork', 'inbox.jsonl')
  const form = { ref: 'WF-01', legalName: 'Minh Tran', taxCountry: 'vn', formSignedAs: 'minh tran' }
  it('accepts paperwork only when signed by the account it names, keeps every submission, owner-only', async () => {
    await submit({ ...form, address: A, signature: A }, digest, recover, file)
    await expect(submit({ ...form, address: A, signature: B }, digest, recover, file)).rejects.toThrow(/not from the payout account/)
    await expect(submit({ ...form, address: A }, digest, recover, file)).rejects.toThrow(/missing signature/)
    await submit({ ...form, address: B, signature: B }, digest, recover, file) // someone else, for their own account
    expect(submissionsByRef(file)['WF-01'].map((s) => s.address)).toEqual([A, B])
    expect(statSync(file).mode & 0o777).toBe(0o600)
  })
  it('matches when signed paperwork exists for the registered account, and lists the others as conflicts', () => {
    const subs = submissionsByRef(file)['WF-01']
    const r = bindingCheck(A, subs)
    expect(r.binding).toBe('match')
    expect(r.others.map((s) => s.address)).toEqual([B])
    expect(bindingCheck('0x0000000000000000000000000000000000000001', subs).binding).toBe('mismatch')
    expect(bindingCheck(A, undefined).binding).toBe('no-paperwork')
    expect(bindingCheck(undefined, subs).binding).toBe('not-registered')
  })
  it('rejects malformed forms and hashes the form canonically', () => {
    expect(() => validateFields({ ref: 'WF-01', address: '0x12', legalName: 'A B', taxCountry: 'KR', formSignedAs: 'A B' })).toThrow(/address/)
    expect(() => validateFields({ ref: 'WF-01', address: A, legalName: 'A B', taxCountry: 'Korea', formSignedAs: 'A B' })).toThrow(/country/)
    const f = validateFields({ ...form, address: A })
    expect(recordHash(f)).toBe(recordHash({ ...f, address: A.toLowerCase() }))
  })
})
