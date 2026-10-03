import type { EscrowEvent } from '../domain/status'
import type { FxQuote } from '../domain/receipt'

export type Hex = `0x${string}`

export interface TxRef {
  hash: Hex
  blockTime: Date
}

export interface NewAward {
  id: Hex // = 32-byte reference = TIP-20 memo
  token: Hex
  amount: bigint
  expiresAt: number // unix seconds
  claimSigner: Hex
}

/** The organizer's escrow on chain. */
export interface EscrowGateway {
  readonly address: Hex
  readonly chainId: number
  /** Approve + fund every award in ONE Tempo transaction (batched calls). */
  fundMany(token: Hex, awards: NewAward[]): Promise<TxRef>
  /** `expectedRecipient` = the registered account the paperwork was checked for, or the zero address (bearer). */
  clear(id: Hex, paperworkHash: Hex, expectedRecipient: Hex, withheld?: bigint): Promise<TxRef>
  /** Clear several awards in one transaction. */
  clearMany(items: { id: Hex; paperworkHash: Hex; expectedRecipient: Hex; withheld?: bigint }[]): Promise<TxRef>
  reissueLink(id: Hex, newSigner: Hex): Promise<TxRef>
  revoke(id: Hex): Promise<TxRef>
  reclaim(id: Hex): Promise<TxRef>
  events(id?: Hex): Promise<EscrowEvent[]>
  chainTime(): Promise<number>
}

/** What a link holder can do. Fees are sponsored; the winner needs no balance. */
export interface WinnerGateway {
  register(args: { escrow: Hex; id: Hex; recipient: Hex; signature: Hex }): Promise<TxRef>
  claim(args: { escrow: Hex; id: Hex; recipient: Hex; signature: Hex }): Promise<TxRef>
}

export interface ClaimKeys {
  create(): { privateKey: Hex; address: Hex }
  /** Signs the escrow's digest for (tag, escrow, chainId, id, recipient) with the link's claim key. */
  sign(args: { purpose: 'claim' | 'register'; claimKey: Hex; escrow: Hex; chainId: number; id: Hex; recipient: Hex }): Promise<Hex>
}

export interface FxRates {
  usdTo(currency: string, onOrBefore: string): Promise<FxQuote>
}
