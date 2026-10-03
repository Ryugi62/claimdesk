import { Relay } from 'viem/tempo'
import { toFunctionSelector, isAddressEqual, type LocalAccount } from 'viem'
import type { Hex } from '../application/ports'

export const CLAIM_SELECTOR = toFunctionSelector('claim(bytes32,address,bytes)')
export const REGISTER_SELECTOR = toFunctionSelector('register(bytes32,address,bytes)')
export const MAX_SPONSORED_GAS = 1_200_000n

export interface SponsorRequest {
  from?: string
  calls?: readonly { to?: string | null; data?: string }[]
  to?: string | null
  data?: string
  gas?: bigint | number | string
  keyAuthorization?: unknown
  aaAuthorizationList?: readonly unknown[]
}

/**
 * Sponsorship policy (pure): the organizer pays fees only for ONE register() or claim() call into its own escrows,
 * with bounded gas and no account-key side effects.
 */
export function sponsorable(escrows: Hex[], tx: SponsorRequest): boolean {
  const calls = tx.calls ?? [{ to: tx.to, data: tx.data }]
  if (calls.length !== 1) return false
  const [c] = calls
  if (!c.to || !escrows.some((e) => isAddressEqual(e, c.to as Hex))) return false
  const data = (c.data ?? '').toLowerCase()
  if (!data.startsWith(CLAIM_SELECTOR) && !data.startsWith(REGISTER_SELECTOR)) return false
  if (tx.gas !== undefined && BigInt(tx.gas) > MAX_SPONSORED_GAS) return false
  if (tx.keyAuthorization) return false
  if (tx.aaAuthorizationList && tx.aaAuthorizationList.length > 0) return false
  return true
}

/** Fixed-window rate limit per key (IP, award). */
export function rateLimiter(limit: number, windowMs: number, now: () => number = Date.now) {
  const hits = new Map<string, number[]>()
  return (key: string): boolean => {
    const t = now()
    const recent = (hits.get(key) ?? []).filter((x) => t - x < windowMs)
    if (recent.length >= limit) {
      hits.set(key, recent)
      return false
    }
    recent.push(t)
    hits.set(key, recent)
    return true
  }
}

/**
 * Relay that co-signs fees with a dedicated fee-payer key (not the organizer key) after:
 * policy check → simulation of the exact call from the sender (no sponsoring of calls that would revert).
 */
export function createSponsorRelay(
  client: { call: (args: { account: Hex; to: Hex; data: Hex }) => Promise<unknown> },
  feePayer: LocalAccount,
  escrows: Hex[],
  name = 'Claimdesk organizer',
) {
  const validate = async (tx: SponsorRequest) => {
    if (!sponsorable(escrows, tx) || !tx.from) return false
    const c = (tx.calls ?? [{ to: tx.to, data: tx.data }])[0]
    try {
      await client.call({ account: tx.from as Hex, to: c.to as Hex, data: c.data as Hex })
      return true
    } catch {
      return false
    }
  }
  return Relay.create({ client, plugins: [Relay.feePayer({ account: feePayer, name, validate: validate as never })] } as never)
}
