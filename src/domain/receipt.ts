import { memoToRef } from './memo'

export interface Payment {
  ref: string
  amount: bigint
  decimals: number
  symbol: string
  txHash: string
  blockTime: Date
  memo: string
  recipient: string
}

export interface FxQuote {
  currency: string
  rate: number // local units per 1 USD
  rateDate: string // YYYY-MM-DD, publication date of the reference rate
  source: string
}

export interface Receipt {
  ref: string
  amountText: string
  symbol: string
  txHash: string
  blockTimeUtc: string
  memo: string
  memoText: string
  recipient: string
  local?: FxQuote & { amountText: string }
}

export function formatUnits(value: bigint, decimals: number): string {
  const neg = value < 0n
  const v = neg ? -value : value
  const base = 10n ** BigInt(decimals)
  const whole = v / base
  const frac = (v % base).toString().padStart(decimals, '0').replace(/0+$/, '')
  return (neg ? '-' : '') + whole.toString() + (frac ? '.' + frac : '')
}

/** ISO 4217 currencies without minor units that a winner is likely to file in. */
const ZERO_DECIMAL = new Set(['KRW', 'JPY', 'VND', 'IDR', 'CLP', 'ISK', 'HUF', 'TWD'])
export const minorUnits = (currency: string) => (ZERO_DECIMAL.has(currency) ? 0 : 2)

function group(value: bigint, decimals: number, places = 2): string {
  // round half up to `places`, then add thousands separators
  const scale = 10n ** BigInt(decimals)
  const unit = 10n ** BigInt(places)
  const minor = (value * unit + scale / 2n) / scale
  const whole = (minor / unit).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return places === 0 ? whole : `${whole}.${(minor % unit).toString().padStart(places, '0')}`
}

export function buildReceipt(p: Payment, fx?: FxQuote): Receipt {
  const receipt: Receipt = {
    ref: p.ref,
    amountText: group(p.amount, p.decimals),
    symbol: p.symbol,
    txHash: p.txHash,
    blockTimeUtc: p.blockTime.toISOString(),
    memo: p.memo,
    memoText: memoToRef(p.memo),
    recipient: p.recipient,
  }
  if (fx) {
    if (fx.rateDate > p.blockTime.toISOString().slice(0, 10)) throw new Error('reference rate is dated after the payment')
    // rate as a fixed-point integer with 6 decimals — no float drift on the money
    const rateMicro = BigInt(Math.round(fx.rate * 1e6))
    const local = p.amount * rateMicro // decimals: p.decimals + 6
    receipt.local = { ...fx, amountText: group(local, p.decimals + 6, minorUnits(fx.currency)) }
  }
  return receipt
}
