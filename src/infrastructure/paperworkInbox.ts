import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { isAddress } from 'viem'
import { paperworkRecordHash } from '../adapters/tempoEscrow'

/**
 * Stand-in for a KYC / tax-form provider. A submission is accepted only with a signature from the payout account it
 * names (passkey or any Tempo account, verified by Tempo's signature-verifier precompile), so nobody can file
 * paperwork for an account they do not control. Every submission is kept; the console shows conflicts.
 */
export const INBOX = 'paperwork/inbox.jsonl'

export interface SubmissionFields {
  ref: string
  address: string
  legalName: string
  taxCountry: string
  formSignedAs: string
}
export interface Submission extends SubmissionFields {
  at: string
  signature: string
  verified: true
}

export function validateFields(x: Partial<SubmissionFields>): SubmissionFields {
  const s = {
    ref: String(x.ref ?? '').trim(),
    address: String(x.address ?? '').trim(),
    legalName: String(x.legalName ?? '').trim(),
    taxCountry: String(x.taxCountry ?? '').trim().toUpperCase(),
    formSignedAs: String(x.formSignedAs ?? '').trim(),
  }
  if (!s.ref || s.ref.length > 31) throw new Error('missing award reference')
  if (!isAddress(s.address)) throw new Error('payout address is not a valid address')
  if (s.legalName.length < 2 || s.legalName.length > 120) throw new Error('enter your full legal name')
  if (!/^[A-Z]{2}$/.test(s.taxCountry)) throw new Error('tax residence must be a 2-letter country code')
  if (s.formSignedAs.toLowerCase() !== s.legalName.toLowerCase()) throw new Error('type your full legal name again to sign')
  return s
}

/** Hash of the form contents the account signs (canonical field order). */
export const recordHash = (f: SubmissionFields) => paperworkRecordHash(f)

/** Accepts a submission only if `recoverSigner(digest)` is the payout account it names. */
export async function submit(
  x: Partial<SubmissionFields> & { signature?: string },
  digestFor: (f: SubmissionFields) => `0x${string}`,
  recoverSigner: (digest: `0x${string}`, signature: `0x${string}`) => Promise<string>,
  file = INBOX,
): Promise<Submission> {
  const f = validateFields(x)
  const signature = String(x.signature ?? '')
  if (!/^0x[0-9a-fA-F]+$/.test(signature)) throw new Error('missing signature from your account')
  let signer = ''
  try {
    signer = await recoverSigner(digestFor(f), signature as `0x${string}`)
  } catch {
    signer = ''
  }
  if (signer.toLowerCase() !== f.address.toLowerCase()) throw new Error('the signature is not from the payout account named in the form')
  const s: Submission = { ...f, at: new Date().toISOString(), signature, verified: true }
  mkdirSync(file.replace(/\/[^/]*$/, ''), { recursive: true })
  appendFileSync(file, JSON.stringify(s) + '\n')
  chmodSync(file, 0o600)
  return s
}

/** All verified submissions per award reference, oldest first. */
export function submissionsByRef(file = INBOX): Record<string, Submission[]> {
  if (!existsSync(file)) return {}
  const out: Record<string, Submission[]> = {}
  for (const l of readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
    const s = JSON.parse(l) as Submission
    if (s.verified) (out[s.ref] ??= []).push(s)
  }
  return out
}

export type Binding = 'match' | 'mismatch' | 'no-paperwork' | 'not-registered'

/** Is there signed paperwork for the registered account? Other accounts' paperwork for the same award = conflict. */
export function bindingCheck(registered: string | undefined, subs: Submission[] | undefined): { binding: Binding; forRegistered?: Submission; others: Submission[] } {
  const list = subs ?? []
  if (list.length === 0) return { binding: 'no-paperwork', others: [] }
  if (!registered) return { binding: 'not-registered', others: list }
  const mine = [...list].reverse().find((s) => s.address.toLowerCase() === registered.toLowerCase())
  const others = list.filter((s) => s.address.toLowerCase() !== registered.toLowerCase())
  return mine ? { binding: 'match', forRegistered: mine, others } : { binding: 'mismatch', others }
}
