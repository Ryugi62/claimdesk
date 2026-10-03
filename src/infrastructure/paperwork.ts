import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { keccak256, toHex } from 'viem'
import type { Hex } from '../application/ports'

/**
 * The organizer's paperwork records — kept on the organizer's machine (append-only, owner-only file);
 * only their hash goes on-chain in clear(). Anyone holding a record can re-derive the hash later.
 */
export const RECORDS = 'paperwork/records.jsonl'

export interface PaperworkRecord {
  ref: string
  recipient: string
  paperwork: string
  at: string
  salt: string
}

const canonical = (r: PaperworkRecord) => JSON.stringify({ at: r.at, paperwork: r.paperwork, recipient: r.recipient.toLowerCase(), ref: r.ref, salt: r.salt })
export const paperworkHash = (r: PaperworkRecord): Hex => keccak256(toHex(canonical(r)))

export function recordPaperwork(ref: string, recipient: string, paperwork: string, file = RECORDS): { record: PaperworkRecord; hash: Hex } {
  if (!paperwork.trim()) throw new Error('describe what was collected (it stays on this machine; only its hash goes on-chain)')
  const record: PaperworkRecord = { ref, recipient, paperwork: paperwork.trim(), at: new Date().toISOString(), salt: toHex(randomBytes(16)) }
  mkdirSync(file.replace(/\/[^/]*$/, ''), { recursive: true })
  appendFileSync(file, JSON.stringify(record) + '\n')
  chmodSync(file, 0o600)
  return { record, hash: paperworkHash(record) }
}

export function recordsFor(ref: string, file = RECORDS): PaperworkRecord[] {
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as PaperworkRecord).filter((r) => r.ref === ref)
}

/** Which local record (if any) produced the on-chain hash. */
export function verifyAgainst(onchainHash: string, ref: string, file = RECORDS): PaperworkRecord | undefined {
  return recordsFor(ref, file).find((r) => paperworkHash(r).toLowerCase() === onchainHash.toLowerCase())
}
