import { Relay } from 'viem/tempo'
import { toFunctionSelector, isAddressEqual, type LocalAccount } from 'viem'
import type { Hex } from '../application/ports'

export const CLAIM_SELECTOR = toFunctionSelector('claim(bytes32,address,bytes)')
export const REGISTER_SELECTOR = toFunctionSelector('register(bytes32,address,bytes)')
export const MAX_SPONSORED_GAS = 1_200_000n
export const MAX_FEE_PER_GAS = 20_000_000_000n
export const MAX_PRIORITY_FEE_PER_GAS = 2_000_000_000n

export interface SponsorRequest {
  from?: string
  calls?: readonly { to?: string | null; data?: string }[]
  to?: string | null
  data?: string
  gas?: bigint | number | string
  maxFeePerGas?: bigint | number | string
  maxPriorityFeePerGas?: bigint | number | string
  feeToken?: string
  keyAuthorization?: unknown
  aaAuthorizationList?: readonly unknown[]
}

/** The award id a sponsored call is about (bytes 4..36 of claim/register calldata). */
export const awardIdOf = (data: string) => ('0x' + data.replace(/^0x/, '').slice(8, 72)).toLowerCase()

/**
 * Sponsorship policy (pure): the organizer pays fees only for ONE register() or claim() call into its own escrows,
 * with bounded gas and no account-key side effects.
 */
export function sponsorable(escrows: Hex[], tx: SponsorRequest, feeTokens: string[] = []): boolean {
  const calls = tx.calls ?? [{ to: tx.to, data: tx.data }]
  if (calls.length !== 1) return false
  const [c] = calls
  if (!c.to || !escrows.some((e) => isAddressEqual(e, c.to as Hex))) return false
  const data = (c.data ?? '').toLowerCase()
  if (!data.startsWith(CLAIM_SELECTOR) && !data.startsWith(REGISTER_SELECTOR)) return false
  if (tx.gas !== undefined && BigInt(tx.gas) > MAX_SPONSORED_GAS) return false
  if (tx.maxFeePerGas !== undefined && BigInt(tx.maxFeePerGas) > MAX_FEE_PER_GAS) return false
  if (tx.maxPriorityFeePerGas !== undefined && BigInt(tx.maxPriorityFeePerGas) > MAX_PRIORITY_FEE_PER_GAS) return false
  if (tx.feeToken && feeTokens.length > 0 && !feeTokens.some((t) => isAddressEqual(t as Hex, tx.feeToken as Hex))) return false
  if (tx.keyAuthorization) return false
  if (tx.aaAuthorizationList && tx.aaAuthorizationList.length > 0) return false
  return true
}

/** Sliding-window rate limit per key (IP, award), with eviction so the map cannot grow without bound. */
export function rateLimiter(limit: number, windowMs: number, now: () => number = Date.now, maxKeys = 10_000) {
  const hits = new Map<string, number[]>()
  return (key: string): boolean => {
    const t = now()
    if (hits.size > maxKeys) for (const [k, v] of hits) if (!v.some((x) => t - x < windowMs)) hits.delete(k)
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
export function sponsorPolicy(
  client: { call: (args: { account: Hex; to: Hex; data: Hex }) => Promise<unknown> },
  escrows: Hex[],
  opts: { feeTokens?: string[]; perAward?: (id: string) => boolean } = {},
) {
  return async (tx: SponsorRequest): Promise<boolean> => {
    if (!sponsorable(escrows, tx, opts.feeTokens) || !tx.from) return false
    const c = (tx.calls ?? [{ to: tx.to, data: tx.data }])[0]
    if (opts.perAward && !opts.perAward(awardIdOf(c.data ?? ''))) return false
    try {
      await client.call({ account: tx.from as Hex, to: c.to as Hex, data: c.data as Hex }) // would it revert? then we don't pay
      return true
    } catch {
      return false
    }
  }
}

/** Relay that co-signs fees with a dedicated fee-payer key (never the organizer key) after `sponsorPolicy`. */
export function createSponsorRelay(
  client: { call: (args: { account: Hex; to: Hex; data: Hex }) => Promise<unknown> },
  feePayer: LocalAccount,
  escrows: Hex[],
  opts: { feeTokens?: string[]; name?: string } = {},
) {
  const perAward = rateLimiter(6, 3_600_000)
  const validate = sponsorPolicy(client, escrows, { feeTokens: opts.feeTokens, perAward })
  return Relay.create({ client, plugins: [Relay.feePayer({ account: feePayer, name: opts.name ?? 'Claimdesk organizer', validate: validate as never })] } as never)
}
