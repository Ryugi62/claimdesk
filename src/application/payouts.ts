import { awardMemo } from '../domain/memo'
import { encodeClaimLink, parseClaimLink } from '../domain/claimLink'
import { reconcile, type AwardView } from '../domain/status'
import { buildReceipt, type Receipt } from '../domain/receipt'
import type { WinnerRow } from '../domain/award'
import type { ClaimKeys, EscrowGateway, FxRates, Hex, TxRef, WinnerGateway } from './ports'

export interface PlannedAward extends WinnerRow {
  id: Hex
  claimKey: Hex
  claimSigner: Hex
  link: string
}

/** UC-1 — fresh claim key and link per winner. Keys exist only in the returned links. */
export function createBatch(winners: WinnerRow[], keys: ClaimKeys, opts: { baseUrl: string; escrow: Hex; chainId: number }): PlannedAward[] {
  return winners.map((w) => {
    const k = keys.create()
    return {
      ...w,
      id: awardMemo(w.ref),
      claimKey: k.privateKey,
      claimSigner: k.address,
      link: encodeClaimLink(opts.baseUrl, { chainId: opts.chainId, escrow: opts.escrow, ref: w.ref, claimKey: k.privateKey }),
    }
  })
}

/** UC-2 — lock every award in the escrow, in one transaction. */
export function fundBatch(awards: PlannedAward[], escrow: EscrowGateway, token: Hex, expiresAt: number): Promise<TxRef> {
  return escrow.fundMany(token, awards.map((a) => ({ id: a.id, token, amount: a.amount, expiresAt, claimSigner: a.claimSigner })))
}

function linkFor(link: string, chainId: number) {
  const d = parseClaimLink(link)
  if (d.chainId !== chainId) throw new Error(`this link is for chain ${d.chainId}, not ${chainId}`)
  return { escrow: d.escrow as Hex, id: awardMemo(d.ref), claimKey: d.claimKey as Hex, chainId: d.chainId }
}

/** UC-3 (path A) — the winner names the account to be paid when paperwork clears. */
export async function registerAccount(link: string, recipient: Hex, keys: ClaimKeys, winner: WinnerGateway, expect: { chainId: number }): Promise<TxRef & { id: Hex }> {
  const l = linkFor(link, expect.chainId)
  const signature = await keys.sign({ purpose: 'register', claimKey: l.claimKey, escrow: l.escrow, chainId: l.chainId, id: l.id, recipient })
  return { ...(await winner.register({ escrow: l.escrow, id: l.id, recipient, signature })), id: l.id }
}

/** UC-4 (path B) — a cleared award with no registered account: the link holder receives it now. */
export async function claimAward(link: string, recipient: Hex, keys: ClaimKeys, winner: WinnerGateway, expect: { chainId: number }): Promise<TxRef & { id: Hex }> {
  const l = linkFor(link, expect.chainId)
  const signature = await keys.sign({ purpose: 'claim', claimKey: l.claimKey, escrow: l.escrow, chainId: l.chainId, id: l.id, recipient })
  return { ...(await winner.claim({ escrow: l.escrow, id: l.id, recipient, signature })), id: l.id }
}

/** UC-7 — one status per award from the chain's own events. */
export async function statusBoard(escrow: EscrowGateway): Promise<Record<string, AwardView>> {
  return reconcile(await escrow.events(), await escrow.chainTime())
}

/** UC-6 — receipt for the winner's records. The local amount is best-effort: no rate → USD only, never an error. */
export async function receiptFor(
  payment: { ref: string; amount: bigint; decimals: number; symbol: string; tx: TxRef; memo: Hex; recipient: Hex },
  fx: FxRates | undefined,
  currency: string | undefined,
): Promise<Receipt> {
  let quote
  if (fx && currency && currency !== 'USD') {
    try {
      quote = await fx.usdTo(currency, payment.tx.blockTime.toISOString().slice(0, 10))
    } catch {
      quote = undefined
    }
  }
  return buildReceipt({ ...payment, txHash: payment.tx.hash, blockTime: payment.tx.blockTime }, quote)
}
