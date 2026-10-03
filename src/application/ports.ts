import type { EscrowEvent } from '../domain/status'
import type { FxQuote } from '../domain/receipt'

export type Hex = `0x${string}`

export interface TxRef {
  hash: Hex
  blockTime: Date
}

export interface NewAward {
  id: Hex // = memo
  token: Hex
  amount: bigint
  expiresAt: number // unix seconds
  claimSigner: Hex
  memo: Hex
}

/** The organizer's escrow on chain. */
export interface EscrowGateway {
  readonly address: Hex
  readonly chainId: number
  fund(award: NewAward): Promise<TxRef>
  clear(id: Hex, paperworkHash: Hex): Promise<TxRef>
  reclaim(id: Hex): Promise<TxRef>
  events(): Promise<EscrowEvent[]>
  chainTime(): Promise<number>
}

/** Submits a winner's claim. The winner signs nothing that costs them money: fees are sponsored. */
export interface ClaimSubmitter {
  submit(args: { escrow: Hex; id: Hex; recipient: Hex; signature: Hex }): Promise<TxRef>
}

export interface ClaimKeys {
  create(): { privateKey: Hex; address: Hex }
  /** Signs the escrow's claim digest for (escrow, chainId, id, recipient) with the link's claim key. */
  signClaim(args: { claimKey: Hex; escrow: Hex; chainId: number; id: Hex; recipient: Hex }): Promise<Hex>
}

export interface FxRates {
  usdTo(currency: string, onOrBefore: string): Promise<FxQuote>
}
