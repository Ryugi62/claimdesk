import { Relay } from 'viem/tempo'
import { toFunctionSelector, isAddressEqual, type LocalAccount } from 'viem'
import type { Hex } from '../application/ports'

export const CLAIM_SELECTOR = toFunctionSelector('claim(bytes32,address,bytes)')

/** Sponsorship policy: the organizer pays fees only for claim() calls into its own escrows. */
export function onlyClaimsTo(escrows: Hex[]) {
  return (tx: { calls?: readonly { to?: string | null; data?: string }[]; to?: string | null; data?: string }) => {
    const calls = tx.calls ?? [{ to: tx.to, data: tx.data }]
    return calls.length > 0 && calls.every((c) => !!c.to && escrows.some((e) => isAddressEqual(e, c.to as Hex)) && (c.data ?? '').toLowerCase().startsWith(CLAIM_SELECTOR))
  }
}

export function createSponsorRelay(client: Parameters<typeof Relay.create>[0]['client'], feePayer: LocalAccount, escrows: Hex[], name = 'Claimdesk organizer') {
  return Relay.create({
    client,
    plugins: [Relay.feePayer({ account: feePayer, name, validate: onlyClaimsTo(escrows) as never })],
  } as never)
}
