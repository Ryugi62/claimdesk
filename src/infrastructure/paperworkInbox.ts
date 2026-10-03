import { appendFileSync, chmodSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { isAddress } from 'viem'

/**
 * Stand-in for a KYC / tax-form provider: the winner's paperwork submission, including the payout address it was
 * made for, lands in an owner-only inbox on the organizer's machine. The console takes the expected recipient for
 * clear() from HERE — never from chain state — so a forwarded link that registered first shows up as a mismatch.
 */
export const INBOX = 'paperwork/inbox.jsonl'

export interface Submission {
  ref: string
  address: string
  legalName: string
  taxCountry: string
  formSignedAs: string
  at: string
}

export function validateSubmission(x: Partial<Submission>): Submission {
  const s = {
    ref: String(x.ref ?? '').trim(),
    address: String(x.address ?? '').trim(),
    legalName: String(x.legalName ?? '').trim(),
    taxCountry: String(x.taxCountry ?? '').trim().toUpperCase(),
    formSignedAs: String(x.formSignedAs ?? '').trim(),
    at: new Date().toISOString(),
  }
  if (!s.ref || s.ref.length > 31) throw new Error('missing award reference')
  if (!isAddress(s.address)) throw new Error('payout address is not a valid address')
  if (s.legalName.length < 2 || s.legalName.length > 120) throw new Error('enter your full legal name')
  if (!/^[A-Z]{2}$/.test(s.taxCountry)) throw new Error('tax residence must be a 2-letter country code')
  if (s.formSignedAs.toLowerCase() !== s.legalName.toLowerCase()) throw new Error('type your full legal name again to sign')
  return s
}

export function submit(x: Partial<Submission>, file = INBOX): Submission {
  const s = validateSubmission(x)
  mkdirSync(file.replace(/\/[^/]*$/, ''), { recursive: true })
  appendFileSync(file, JSON.stringify(s) + '\n')
  chmodSync(file, 0o600)
  return s
}

/** Latest submission per award reference. */
export function latestSubmissions(file = INBOX): Record<string, Submission> {
  if (!existsSync(file)) return {}
  const out: Record<string, Submission> = {}
  for (const l of readFileSync(file, 'utf8').split('\n').filter(Boolean)) {
    const s = JSON.parse(l) as Submission
    out[s.ref] = s
  }
  return out
}

/** What the organizer should see before clearing. */
export function bindingCheck(registered: string | undefined, submitted: string | undefined): 'match' | 'mismatch' | 'no-paperwork' | 'not-registered' {
  if (!submitted) return 'no-paperwork'
  if (!registered) return 'not-registered'
  return registered.toLowerCase() === submitted.toLowerCase() ? 'match' : 'mismatch'
}
