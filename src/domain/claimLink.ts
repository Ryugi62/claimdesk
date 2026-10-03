/** Claim link: the one-time claim key travels only in the URL fragment (never sent to a server). */
export interface ClaimLinkData {
  chainId: number
  escrow: string
  ref: string
  claimKey: string
}

// CRC-32 (IEEE) — catches typos and copy-paste damage; authenticity comes from the claim key's signature on-chain.
function crc32(text: string): string {
  let c = ~0 >>> 0
  for (let i = 0; i < text.length; i++) {
    c ^= text.charCodeAt(i)
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
  }
  return ((~c) >>> 0).toString(16).padStart(8, '0')
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const KEY = /^0x[0-9a-fA-F]{64}$/

export function encodeClaimLink(baseUrl: string, d: ClaimLinkData): string {
  if (!ADDRESS.test(d.escrow)) throw new Error('escrow must be an address')
  if (!KEY.test(d.claimKey)) throw new Error('claim key must be 32 bytes')
  const body = ['v1', String(d.chainId), d.escrow, encodeURIComponent(d.ref), d.claimKey].join('.')
  return `${baseUrl.replace(/\/$/, '')}/claim#${body}.${crc32(body)}`
}

export function parseClaimLink(link: string): ClaimLinkData {
  const frag = link.includes('#') ? link.slice(link.indexOf('#') + 1) : link
  const parts = frag.split('.')
  if (parts.length !== 6 || parts[0] !== 'v1') throw new Error('not a Claimdesk claim link')
  const [v, chain, escrow, ref, key, sum] = parts
  const body = [v, chain, escrow, ref, key].join('.')
  if (crc32(body) !== sum) throw new Error('claim link checksum does not match — the link was changed or cut')
  if (!ADDRESS.test(escrow) || !KEY.test(key) || !/^\d+$/.test(chain)) throw new Error('claim link is malformed')
  return { chainId: Number(chain), escrow, ref: decodeURIComponent(ref), claimKey: key }
}
