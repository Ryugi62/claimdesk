import { awardMemo } from '../domain/memo'
import { encodeClaimLink, parseClaimLink } from '../domain/claimLink'
import { reconcile, type AwardView } from '../domain/status'
import { buildReceipt, type Receipt } from '../domain/receipt'
import type { WinnerRow } from '../domain/award'
import type { ClaimKeys, ClaimSubmitter, EscrowGateway, FxRates, Hex, TxRef } from './ports'

export interface PlannedAward extends WinnerRow {
  id: Hex
  memo: Hex
  claimKey: Hex
  claimSigner: Hex
  link: string
}

/** UC-1 — fresh claim key and link per winner. Keys exist only in the returned links. */
export function createBatch(winners: WinnerRow[], keys: ClaimKeys, opts: { baseUrl: string; escrow: Hex; chainId: number }): PlannedAward[] {
  return winners.map((w) => {
    const memo = awardMemo(w.ref)
    const k = keys.create()
    return {
      ...w,
      id: memo,
      memo,
      claimKey: k.privateKey,
      claimSigner: k.address,
      link: encodeClaimLink(opts.baseUrl, { chainId: opts.chainId, escrow: opts.escrow, ref: w.ref, claimKey: k.privateKey }),
    }
  })
}

/** UC-2 — lock every award in the escrow. */
export async function fundBatch(awards: PlannedAward[], escrow: EscrowGateway, token: Hex, expiresAt: number): Promise<TxRef[]> {
  const txs: TxRef[] = []
  for (const a of awards) {
    txs.push(await escrow.fund({ id: a.id, token, amount: a.amount, expiresAt, claimSigner: a.claimSigner, memo: a.memo }))
  }
  return txs
}

/** UC-4 — the winner's side: link + their new account → sponsored claim. */
export async function claimAward(link: string, recipient: Hex, keys: ClaimKeys, submitter: ClaimSubmitter, expect: { chainId: number }): Promise<TxRef & { id: Hex }> {
  const d = parseClaimLink(link)
  if (d.chainId !== expect.chainId) throw new Error(`this link is for chain ${d.chainId}, not ${expect.chainId}`)
  const id = awardMemo(d.ref)
  const signature = await keys.signClaim({ claimKey: d.claimKey as Hex, escrow: d.escrow as Hex, chainId: d.chainId, id, recipient })
  const tx = await submitter.submit({ escrow: d.escrow as Hex, id, recipient, signature })
  return { ...tx, id }
}

/** UC-7 — one status per award from the chain's own events. */
export async function statusBoard(escrow: EscrowGateway): Promise<Record<string, AwardView>> {
  return reconcile(await escrow.events(), await escrow.chainTime())
}

/** UC-6 — receipt for the winner's records, with the local amount at the payment date. */
export async function receiptFor(
  payment: { ref: string; amount: bigint; decimals: number; symbol: string; tx: TxRef; memo: Hex; recipient: Hex },
  fx: FxRates | undefined,
  currency: string | undefined,
): Promise<Receipt> {
  const quote = fx && currency && currency !== 'USD' ? await fx.usdTo(currency, payment.tx.blockTime.toISOString().slice(0, 10)) : undefined
  return buildReceipt({ ...payment, txHash: payment.tx.hash, blockTime: payment.tx.blockTime }, quote)
}
