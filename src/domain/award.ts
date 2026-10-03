import { awardMemo } from './memo'

export interface WinnerRow {
  ref: string
  amount: bigint // base units
  label: string
}

/** Decimal string → base units, exact (no floats). */
export function parseUnits(text: string, decimals: number): bigint {
  const t = text.trim()
  if (!/^\d+(\.\d+)?$/.test(t)) throw new Error(`amount "${text}" is not a number`)
  const [whole, frac = ''] = t.split('.')
  if (frac.length > decimals) throw new Error(`amount "${text}" has more than ${decimals} decimals`)
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, '0') || '0')
}

/** Winners CSV: header `ref,amount,label`. Amounts in whole token units. */
export function parseWinners(csv: string, decimals: number): WinnerRow[] {
  const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const header = lines.shift()?.toLowerCase().replace(/\s/g, '')
  if (header !== 'ref,amount,label') throw new Error('winners file must start with: ref,amount,label')
  const seen = new Set<string>()
  return lines.map((line, i) => {
    const [ref, amountText, ...labelParts] = line.split(',')
    const label = labelParts.join(',').trim()
    awardMemo(ref.trim()) // validates the reference
    if (seen.has(ref.trim())) throw new Error(`row ${i + 2}: duplicate reference ${ref}`)
    seen.add(ref.trim())
    const amount = parseUnits(amountText ?? '', decimals)
    if (amount <= 0n) throw new Error(`row ${i + 2}: amount must be greater than 0`)
    return { ref: ref.trim(), amount, label }
  })
}
