import { http, type Chain } from 'viem'
import { tempoModerato, tempo } from 'viem/chains'
import { Account, WebAuthnP256, withRelay } from 'viem/tempo'
import { WebAuthnP256 as OxWebAuthn, P256, Hash, Bytes, Hex as OxHex, PublicKey } from 'ox'
import { tempoClient, resilientHttp } from '../src/adapters/tempoEscrow'
import { formatUnits } from '../src/domain/receipt'
import type { Hex } from '../src/application/ports'

export interface Config {
  chainId: number
  rpc: string
  /** fee sponsor endpoint: '/relay' (organizer's own relay) or Tempo's public testnet fee payer */
  sponsor: string
  explorer: string
  program: string
  /** escrow → deploy block, so receipts can find their transaction quickly */
  escrows?: Record<string, number>
}

export async function loadConfig(): Promise<Config> {
  const res = await fetch('config.json', { cache: 'no-store' })
  if (!res.ok) throw new Error('config.json missing')
  return res.json()
}

export const chainFor = (id: number): Chain => (id === tempo.id ? tempo : tempoModerato)

export function readClient(cfg: Config) {
  return tempoClient(chainFor(cfg.chainId), undefined, resilientHttp(cfg.rpc))
}

/** Client whose transactions are fee-sponsored (the sender needs no balance). */
export function sponsoredClient(cfg: Config, account: ReturnType<typeof Account.fromWebAuthnP256> | ReturnType<typeof Account.fromSecp256k1>) {
  const sponsor = cfg.sponsor.startsWith('http') ? cfg.sponsor : new URL(cfg.sponsor, location.href).toString()
  return tempoClient(chainFor(cfg.chainId), account as never, withRelay(resilientHttp(cfg.rpc), http(sponsor)) as never)
}

/** Client that pays its own fee in the stablecoin it holds (Tempo has no gas token). */
export function selfPayClient(cfg: Config, account: ReturnType<typeof Account.fromWebAuthnP256>) {
  return tempoClient(chainFor(cfg.chainId), account as never, resilientHttp(cfg.rpc))
}

// ---------------------------------------------------------------- passkeys

const STORE = 'claimdesk:passkey'
export interface SavedPasskey { id: string; publicKey: Hex }

export function savedPasskey(): SavedPasskey | undefined {
  try {
    const v = localStorage.getItem(STORE)
    return v ? JSON.parse(v) : undefined
  } catch {
    return undefined
  }
}
function save(p: SavedPasskey) {
  try { localStorage.setItem(STORE, JSON.stringify(p)) } catch { /* private mode: account still works this session */ }
}

export async function createPasskey(label: string): Promise<SavedPasskey> {
  const c = await WebAuthnP256.createCredential({ label } as never)
  const p = { id: c.id, publicKey: c.publicKey as Hex }
  save(p)
  return p
}

/**
 * Sign in with an existing passkey on a device that has no saved public key:
 * two assertions → recover both candidate P-256 keys each time → the key in both is the account.
 */
export async function signInWithPasskey(): Promise<SavedPasskey> {
  const candidates: string[][] = []
  let credentialId = ''
  for (let i = 0; i < 2; i++) {
    const challenge = OxHex.random(32)
    const { metadata, signature, raw } = await OxWebAuthn.sign({ challenge, credentialId: credentialId || undefined } as never)
    credentialId = (raw as { id: string }).id
    const clientDataHash = Hash.sha256(Bytes.fromString(metadata.clientDataJSON))
    const payload = Hash.sha256(Bytes.concat(Bytes.fromHex(metadata.authenticatorData), clientDataHash))
    const keys: string[] = []
    for (const yParity of [0, 1]) {
      try {
        keys.push(PublicKey.toHex(P256.recoverPublicKey({ payload, signature: { ...signature, yParity } }), { includePrefix: false }))
      } catch { /* not a valid point for this parity */ }
    }
    candidates.push(keys)
  }
  const match = candidates[0].find((k) => candidates[1].includes(k))
  if (!match) throw new Error('Could not recognise this passkey. Try again on the device where you created it.')
  const p = { id: credentialId, publicKey: match as Hex }
  save(p)
  return p
}

export const accountOf = (p: SavedPasskey) => Account.fromWebAuthnP256(p as never)

// ---------------------------------------------------------------- view helpers

export const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
export const money = (base: bigint, decimals: number) =>
  Number(formatUnits(base, decimals)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`

const LOCAL: Record<string, string> = { ko: 'KRW', ja: 'JPY', hi: 'INR', id: 'IDR', th: 'THB', de: 'EUR', fr: 'EUR', es: 'EUR', it: 'EUR', nl: 'EUR', pt: 'BRL', tr: 'TRY', pl: 'PLN', 'en-GB': 'GBP', 'en-IN': 'INR', 'en-PH': 'PHP', 'en-AU': 'AUD', 'en-CA': 'CAD', 'zh-CN': 'CNY' }
export function localCurrency(): string {
  const q = new URLSearchParams(location.search).get('currency')
  return q ?? LOCAL[navigator.language] ?? LOCAL[navigator.language.slice(0, 2)] ?? 'USD'
}
