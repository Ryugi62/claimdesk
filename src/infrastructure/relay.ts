import { Relay } from 'viem/tempo'
import { toFunctionSelector, isAddressEqual, type LocalAccount } from 'viem'
import type { Hex } from '../application/ports'

export const CLAIM_SELECTOR = toFunctionSelector('claim(bytes32,address,bytes)')
export const REGISTER_SELECTOR = toFunctionSelector('register(bytes32,address,bytes)')
export const CHANGE_RECIPIENT_SELECTOR = toFunctionSelector('changeRecipient(bytes32,address)')
export const MAX_SPONSORED_GAS = 1_200_000n
export const MAX_FEE_PER_GAS = 5_000_000_000n
export const MAX_PRIORITY_FEE_PER_GAS = 1_000_000_000n
/** Sponsored transactions must expire soon (Tempo validBefore), so a co-signed transaction cannot be held and replayed later. */
export const MAX_VALID_FOR_SECONDS = 180

export interface SponsorRequest {
  from?: string
  calls?: readonly { to?: string | null; data?: string }[]
  to?: string | null
  data?: string
  gas?: bigint | number | string
  maxFeePerGas?: bigint | number | string
  maxPriorityFeePerGas?: bigint | number | string
  feeToken?: string
  validBefore?: bigint | number | string
  keyAuthorization?: unknown
  aaAuthorizationList?: readonly unknown[]
}

/** The award id a sponsored call is about (bytes 4..36 of claim/register calldata). */
export const awardIdOf = (data: string) => ('0x' + data.replace(/^0x/, '').slice(8, 72)).toLowerCase()

/**
 * Sponsorship policy (pure): the organizer pays fees only for ONE register() / claim() / changeRecipient() call into
 * its own escrows, with gas, fee caps and a short validity window all present and bounded, and no account-key side effects.
 */
export function sponsorable(escrows: Hex[], tx: SponsorRequest, feeTokens: string[] = [], nowSec = Math.floor(Date.now() / 1000)): boolean {
  const calls = tx.calls ?? [{ to: tx.to, data: tx.data }]
  if (calls.length !== 1) return false
  // caps are mandatory, not optional: a missing field is a refusal
  if (tx.gas === undefined || tx.maxFeePerGas === undefined || tx.maxPriorityFeePerGas === undefined || tx.validBefore === undefined) return false
  if (Number(tx.validBefore) > nowSec + MAX_VALID_FOR_SECONDS) return false
  const [c] = calls
  if (!c.to || !escrows.some((e) => isAddressEqual(e, c.to as Hex))) return false
  const data = (c.data ?? '').toLowerCase()
  if (![CLAIM_SELECTOR, REGISTER_SELECTOR, CHANGE_RECIPIENT_SELECTOR].some((sel) => data.startsWith(sel))) return false
  if (tx.gas !== undefined && BigInt(tx.gas) > MAX_SPONSORED_GAS) return false
  if (BigInt(tx.maxFeePerGas) > MAX_FEE_PER_GAS) return false
  if (BigInt(tx.maxPriorityFeePerGas) > MAX_PRIORITY_FEE_PER_GAS) return false
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
    try {
      await client.call({ account: tx.from as Hex, to: c.to as Hex, data: c.data as Hex }) // would it revert? then we don't pay
    } catch {
      return false
    }
    // only calls that would succeed count against the per-award budget, so junk calls cannot exhaust a winner's quota
    return !opts.perAward || opts.perAward(awardIdOf(c.data ?? ''))
  }
}

/** JSON-RPC methods the public relay answers; everything else (and fee-payer signing without broadcast) is refused. */
export const RELAY_METHODS = ['eth_chainId', 'eth_fillTransaction', 'eth_sendRawTransaction', 'eth_sendRawTransactionSync'] as const
export function relayMethodAllowed(body: unknown): boolean {
  const reqs = Array.isArray(body) ? body : [body]
  return reqs.length > 0 && reqs.length <= 4 && reqs.every((r) => !!r && typeof r === 'object' && (RELAY_METHODS as readonly string[]).includes(String((r as { method?: unknown }).method)))
}

/** Client IP: the socket address, or the first X-Forwarded-For hop when (and only when) we sit behind our own proxy. */
export function clientIp(socketAddress: string | undefined, forwardedFor: string | string[] | undefined, trustProxy: boolean): string {
  const xff = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor
  if (trustProxy && xff) return xff.split(',')[0].trim()
  return socketAddress ?? '?'
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
