import type { FxRates } from '../application/ports'
import type { FxQuote } from '../domain/receipt'

/** ECB reference rates via frankfurter.app (free, no key). Returns the latest publication on or before the date. */
export class EcbRates implements FxRates {
  constructor(private fetchFn: typeof fetch = (...a) => fetch(...a), private base = 'https://api.frankfurter.dev/v1') {}
  async usdTo(currency: string, onOrBefore: string): Promise<FxQuote> {
    const res = await this.fetchFn(`${this.base}/${onOrBefore}?from=USD&to=${encodeURIComponent(currency)}`)
    if (!res.ok) throw new Error(`rate lookup failed: HTTP ${res.status}`)
    const body = (await res.json()) as { date: string; rates: Record<string, number> }
    const rate = body.rates?.[currency]
    if (typeof rate !== 'number') throw new Error(`no ECB reference rate for ${currency}`)
    return { currency, rate, rateDate: body.date, source: 'ECB euro foreign exchange reference rates (via frankfurter.dev)' }
  }
}
