/** Award status from escrow events — the organizer's reconciliation view. */
export type AwardStatus = 'Funded' | 'Cleared' | 'Claimed' | 'Expired' | 'Reclaimed' | 'Inconsistent'

export type EscrowEvent =
  | { kind: 'Funded'; id: string; amount: bigint; expiresAt: number; txHash?: string }
  | { kind: 'Cleared'; id: string; paperworkHash?: string; txHash?: string }
  | { kind: 'Claimed'; id: string; recipient: string; txHash?: string }
  | { kind: 'Reclaimed'; id: string; txHash?: string }

export interface AwardView {
  id: string
  status: AwardStatus
  amount?: bigint
  expiresAt?: number
  recipient?: string
  txs: Partial<Record<'Funded' | 'Cleared' | 'Claimed' | 'Reclaimed', string>>
}

const NEXT: Record<string, Partial<Record<EscrowEvent['kind'], AwardStatus>>> = {
  None: { Funded: 'Funded' },
  Funded: { Cleared: 'Cleared', Reclaimed: 'Reclaimed' },
  Cleared: { Claimed: 'Claimed', Reclaimed: 'Reclaimed' },
}

/** `nowSec` = chain time in seconds. Events must be in chain order. */
export function reconcile(events: EscrowEvent[], nowSec: number): Record<string, AwardView> {
  const out: Record<string, AwardView & { raw: string }> = {}
  for (const e of events) {
    const v = (out[e.id] ??= { id: e.id, status: 'Funded', raw: 'None', txs: {} })
    const next = NEXT[v.raw]?.[e.kind]
    if (!next) {
      v.raw = 'Inconsistent'
      v.status = 'Inconsistent'
      continue
    }
    v.raw = next
    v.status = next
    if (e.txHash) v.txs[e.kind] = e.txHash
    if (e.kind === 'Funded') {
      v.amount = e.amount
      v.expiresAt = e.expiresAt
    }
    if (e.kind === 'Claimed') v.recipient = e.recipient
  }
  const result: Record<string, AwardView> = {}
  for (const [id, { raw, ...v }] of Object.entries(out)) {
    if ((raw === 'Funded' || raw === 'Cleared') && v.expiresAt !== undefined && nowSec >= v.expiresAt) v.status = 'Expired'
    result[id] = v
  }
  return result
}
