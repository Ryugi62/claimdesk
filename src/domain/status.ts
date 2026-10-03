/** Award status from escrow events — the organizer's reconciliation view and the winner's page. */
export type AwardStatus = 'Funded' | 'Registered' | 'Cleared' | 'Claimed' | 'Expired' | 'Reclaimed' | 'Revoked' | 'Inconsistent'

export type EscrowEvent =
  | { kind: 'Funded'; id: string; amount: bigint; expiresAt: number; txHash?: string }
  | { kind: 'Registered'; id: string; recipient: string; txHash?: string }
  | { kind: 'RecipientChanged'; id: string; recipient: string; txHash?: string }
  | { kind: 'LinkReissued'; id: string; txHash?: string }
  | { kind: 'ReissueScheduled'; id: string; notBefore?: number; txHash?: string }
  | { kind: 'Cleared'; id: string; paperworkHash?: string; withheld?: bigint; txHash?: string }
  | { kind: 'Claimed'; id: string; recipient: string; amount?: bigint; txHash?: string }
  | { kind: 'Revoked'; id: string; txHash?: string }
  | { kind: 'Reclaimed'; id: string; txHash?: string }

export interface AwardView {
  id: string
  status: AwardStatus
  amount?: bigint
  expiresAt?: number
  /** account registered through the link (paid automatically on clearance) */
  registered?: string
  /** account actually paid */
  recipient?: string
  withheld?: bigint
  paperworkHash?: string
  /** a new link is scheduled to replace the registration at this time (unix s) */
  reissueAt?: number
  txs: Partial<Record<EscrowEvent['kind'], string>>
}

type Raw = 'None' | 'Funded' | 'Registered' | 'Cleared' | 'Claimed' | 'Reclaimed' | 'Revoked' | 'Inconsistent'
const NEXT: Record<Raw, Partial<Record<EscrowEvent['kind'], Raw>>> = {
  None: { Funded: 'Funded' },
  Funded: { Registered: 'Registered', LinkReissued: 'Funded', Cleared: 'Cleared', Revoked: 'Revoked', Reclaimed: 'Reclaimed' },
  Registered: { RecipientChanged: 'Registered', ReissueScheduled: 'Registered', LinkReissued: 'Funded', Cleared: 'Cleared', Revoked: 'Revoked', Reclaimed: 'Reclaimed' },
  Cleared: { Claimed: 'Claimed', Reclaimed: 'Reclaimed' },
  Claimed: {},
  Reclaimed: {},
  Revoked: {},
  Inconsistent: {},
}

/** `nowSec` = chain time in seconds. Events must be in chain order. Unknown transitions are flagged, never hidden. */
export function reconcile(events: EscrowEvent[], nowSec: number): Record<string, AwardView> {
  const out: Record<string, AwardView & { raw: Raw }> = {}
  for (const e of events) {
    const v = (out[e.id] ??= { id: e.id, status: 'Funded', raw: 'None', txs: {} })
    const next = NEXT[v.raw][e.kind]
    if (!next) {
      v.raw = 'Inconsistent'
      v.status = 'Inconsistent'
      continue
    }
    v.raw = next
    v.status = next as AwardStatus
    if (e.txHash) v.txs[e.kind] = e.txHash
    if (e.kind === 'Funded') {
      v.amount = e.amount
      v.expiresAt = e.expiresAt
    }
    if (e.kind === 'Registered' || e.kind === 'RecipientChanged') v.registered = e.recipient
    if (e.kind === 'LinkReissued') {
      v.registered = undefined
      v.reissueAt = undefined
    }
    if (e.kind === 'ReissueScheduled') v.reissueAt = e.notBefore
    if (e.kind === 'Cleared') {
      v.paperworkHash = e.paperworkHash
      if (e.withheld) v.withheld = e.withheld
    }
    if (e.kind === 'Claimed') v.recipient = e.recipient
  }
  const result: Record<string, AwardView> = {}
  for (const [id, { raw, ...v }] of Object.entries(out)) {
    if ((raw === 'Funded' || raw === 'Registered' || raw === 'Cleared') && v.expiresAt !== undefined && nowSec >= v.expiresAt) v.status = 'Expired'
    result[id] = v
  }
  return result
}

/** One sentence per state, for the people on both sides. */
export function describe(v: Pick<AwardView, 'status'>): { tone: 'ok' | 'warn' | 'no'; organizer: string; winner: string } {
  switch (v.status) {
    case 'Funded':
      return { tone: 'warn', organizer: 'Waiting for the winner to open the link', winner: 'Your award is locked for you. Create your account now — it is paid there automatically once the organizer approves your paperwork.' }
    case 'Registered':
      return { tone: 'ok', organizer: 'Account ready — check paperwork for this address, then clear', winner: 'Your account is ready. You will be paid automatically when the organizer approves your paperwork.' }
    case 'Cleared':
      return { tone: 'ok', organizer: 'Paperwork approved — winner can receive', winner: 'Paperwork approved. Receive it in one step.' }
    case 'Claimed':
      return { tone: 'ok', organizer: 'Paid', winner: 'Paid.' }
    case 'Expired':
      return { tone: 'no', organizer: 'Expired — reclaim it', winner: 'This award expired. Contact the organizer.' }
    case 'Reclaimed':
      return { tone: 'no', organizer: 'Returned to you after expiry', winner: 'This award expired and went back to the organizer.' }
    case 'Revoked':
      return { tone: 'no', organizer: 'Revoked', winner: 'The organizer cancelled this award.' }
    default:
      return { tone: 'no', organizer: 'Check history', winner: 'Something is off with this award. Contact the organizer.' }
  }
}
