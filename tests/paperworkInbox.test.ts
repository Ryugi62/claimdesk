import { describe, it, expect } from 'vitest'
import { mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { submit, latestSubmissions, bindingCheck, validateSubmission } from '../src/infrastructure/paperworkInbox'

const A = '0x846aAa3024e0f06A4a0B24151B9FCc57dcF38632'
const B = '0x000000000000000000000000000000000000bEEF'
describe('paperwork inbox (KYC/tax-form stand-in)', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'cd-')), 'paperwork', 'inbox.jsonl')
  it('keeps the latest submission per award, owner-only', () => {
    submit({ ref: 'WF-01', address: B, legalName: 'Kim Taegul', taxCountry: 'kr', formSignedAs: 'kim taegul' }, file)
    submit({ ref: 'WF-01', address: A, legalName: 'Kim Taegul', taxCountry: 'KR', formSignedAs: 'Kim Taegul' }, file)
    expect(latestSubmissions(file)['WF-01'].address).toBe(A)
    expect(statSync(file).mode & 0o777).toBe(0o600)
  })
  it('rejects malformed submissions', () => {
    expect(() => validateSubmission({ ref: 'WF-01', address: '0x12', legalName: 'A B', taxCountry: 'KR', formSignedAs: 'A B' })).toThrow(/address/)
    expect(() => validateSubmission({ ref: 'WF-01', address: A, legalName: 'A B', taxCountry: 'Korea', formSignedAs: 'A B' })).toThrow(/country/)
    expect(() => validateSubmission({ ref: 'WF-01', address: A, legalName: 'A B', taxCountry: 'KR', formSignedAs: 'someone else' })).toThrow(/sign/)
  })
  it('flags a forwarded link: registered account ≠ the account the paperwork was submitted for', () => {
    expect(bindingCheck(A, A.toLowerCase())).toBe('match')
    expect(bindingCheck(B, A)).toBe('mismatch')
    expect(bindingCheck(A, undefined)).toBe('no-paperwork')
    expect(bindingCheck(undefined, A)).toBe('not-registered')
  })
})
