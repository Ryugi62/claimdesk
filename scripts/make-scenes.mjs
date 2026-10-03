// Builds the scene lists for the pitch and demo recordings from docs/pitch.md / docs/demo narration and two fresh awards.
//   node scripts/make-scenes.mjs <batches/*.links.json> <REF for the opening clip> <REF for the walkthrough> "<console URL with #token>"
import { readFileSync, writeFileSync } from 'node:fs'

const [linksFile, refA, refB, consoleUrl] = process.argv.slice(2)
const links = Object.fromEntries(JSON.parse(readFileSync(linksFile, 'utf8')).map((r) => [r.ref, r.link]))
const pitch = readFileSync('docs/pitch.md', 'utf8').split('\n').filter((l) => /^\| \d+ \|/.test(l)).map((l) => l.split('|')[3].trim())
const S = (id) => `docs/video/slides.html#${id}`
const D = (id) => `docs/video/demo-slides.html#${id}`
const clear = (ref, note) => [`waitfor:[data-clear="${ref}"]`, `click:[data-clear="${ref}"]`, `fill:#dlgNote=${note}`, 'wait:500', 'click:#dlgOk', 'wait:6000']

const pitchScenes = [
  { id: 'p01', url: links[refA], passkey: true, en: pitch[0], actions: ['wait:600', 'click:#cta', 'waitfor:#registered', 'wait:800', `goto:${consoleUrl}`, ...clear(refA, 'W-8BEN signed; identity checked; address confirmed'), `goto:${links[refA]}`, 'waitfor:.local'] },
  { id: 'p02', url: S('q'), en: pitch[1] },
  { id: 'p03', url: S('s3'), en: pitch[2] },
  { id: 'p04', url: S('s4'), en: pitch[3] },
  { id: 'p05', url: links[refB], en: pitch[4], actions: ['wait:600', 'click:#cta', 'waitfor:#registered', 'wait:600', 'scroll:#registered'] },
  { id: 'p06', url: consoleUrl, en: pitch[5], actions: [`waitfor:[data-clear="${refB}"]`, `click:[data-clear="${refB}"]`, 'fill:#dlgNote=W-8BEN signed 2026-10-06; identity check passed', 'fill:#dlgBps=0', 'wait:2500', 'click:#dlgOk', 'wait:5000', `goto:${D('d1')}`] },
  { id: 'p07', url: links[refB], en: pitch[6], actions: ['waitfor:.local', 'wait:1500', 'click:#cta', 'wait:800', 'goto:http://localhost:5174/account', 'waitfor:#to', 'fill:#to=0x000000000000000000000000000000000000dEaD', 'fill:#amount=250', 'fill:#memo=DEPOSIT-TAG-77', 'click:#cta', 'waitfor:#sent'] },
  { id: 'p08', url: S('s10'), en: pitch[7] },
  { id: 'p09', url: S('s11'), en: pitch[8] },
  { id: 'p10', url: S('s12'), en: pitch[9] },
  { id: 'p11', url: S('s13'), en: pitch[10] },
]
writeFileSync('docs/video/pitch.json', JSON.stringify(pitchScenes, null, 1))

const demo = [
  ['d1', D('d1'), 'This is the attack Claimdesk is built around. A forwarded claim link registers its own account before the real winner. The organizer clears the paperwork for the address it actually checked, and the escrow refuses with RecipientMismatch, mined on Tempo testnet. The organizer reissues the link, the old link fails its signature check, and the real winner is paid. The forwardee gets nothing.'],
  ['d2', D('d2'), 'Registration is write-once. The link key signs a domain-tagged digest over the escrow, the chain, the award and the recipient, and the recipient then replaces the link key in the same storage slot. Two slots per award, which matters on Tempo, where every new slot costs two hundred fifty thousand gas.'],
  ['d3', D('d3'), 'Clearing must name the account the paperwork was checked for. A registered award is paid in the same call, with optional tax withheld at source to a tax account. Both transfers carry the award reference as their TIP-20 memo. After clearance the organizer can no longer revoke or reissue.'],
  ['d4', D('d4'), 'On the Tempo side: one transaction with batched calls funds every award. The winner\'s passkey is the account. Our relay co-signs as fee payer, and the account page pays its own fees in the stablecoin, because Tempo has no gas token.'],
  ['d5', D('d5'), 'The relay only sponsors a single register or claim call into our own escrow, with gas and fee caps, a pinned fee token and no key authorizations. It then simulates the exact call and applies per-IP and per-award limits. It runs in its own process with only a small fee-payer key.'],
  ['d6', consoleUrl, 'The organizer console runs only on the organizer\'s machine, behind a loopback check, a host allow-list and a session token. Status is rebuilt from escrow events. Clearing shows the address and amount and requires a paperwork note, which stays local while its salted hash goes on-chain.'],
  ['d7', links[refB], 'And the winner\'s side, at phone width: the receipt in their own currency, with a PDF, and the account page that sends on to an exchange deposit address with a tag.'],
]
writeFileSync('docs/video/demo.json', JSON.stringify(demo.map(([id, url, en]) => ({ id, url, en, actions: id === 'd7' ? ['waitfor:.local', 'wait:2500', 'goto:http://localhost:5174/account', 'waitfor:#to'] : id === 'd6' ? ['waitfor:.row', 'wait:1500', 'scroll:details'] : [] })), null, 1))
console.log('scenes written: docs/video/pitch.json, docs/video/demo.json')
