import { describe, it, expect } from 'vitest'
import { mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { recordPaperwork, verifyAgainst, paperworkHash } from '../src/infrastructure/paperwork'

describe('paperwork records', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'cd-')), 'paperwork', 'records.jsonl')
  it('stores the record locally (owner-only) and re-derives the on-chain hash later', () => {
    const { record, hash } = recordPaperwork('WF-01', '0xAbC', 'W-8BEN received 2026-10-05, identity checked by vendor id 123', file)
    expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(paperworkHash(record)).toBe(hash)
    expect(verifyAgainst(hash, 'WF-01', file)).toEqual(record)
    expect(verifyAgainst(hash, 'WF-02', file)).toBeUndefined()
  })
  it('refuses an empty description', () => {
    expect(() => recordPaperwork('WF-01', '0x', '   ', file)).toThrow(/describe/)
  })
  it('salts records so identical paperwork does not give identical hashes', () => {
    const a = recordPaperwork('WF-03', '0x1', 'same', file).hash
    const b = recordPaperwork('WF-03', '0x1', 'same', file).hash
    expect(a).not.toBe(b)
  })
})
