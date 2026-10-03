/** Award reference ⇄ 32-byte TIP-20 memo. The memo is also the award id in the escrow. */
export type Hex32 = `0x${string}`

const PRINTABLE = /^[\x20-\x7e]+$/

export function awardMemo(ref: string): Hex32 {
  if (!ref) throw new Error('award reference is empty')
  if (!PRINTABLE.test(ref)) throw new Error('award reference must be printable ASCII')
  if (ref.length > 31) throw new Error('award reference must be at most 31 characters')
  let hex = ''
  for (const ch of ref) hex += ch.charCodeAt(0).toString(16).padStart(2, '0')
  return `0x${hex.padEnd(64, '0')}` as Hex32
}

export function memoToRef(memo: string): string {
  const hex = memo.replace(/^0x/, '')
  if (hex.length !== 64) throw new Error('memo must be 32 bytes')
  let out = ''
  for (let i = 0; i < 64; i += 2) {
    const code = parseInt(hex.slice(i, i + 2), 16)
    if (code === 0) break
    out += String.fromCharCode(code)
  }
  return out
}
