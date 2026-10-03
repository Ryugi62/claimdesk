// Builds the scene lists for the pitch and demo recordings (see scripts/prep-recording.ts for the staged awards).
//   node scripts/make-scenes.mjs '<prep JSON>' "<console URL with #token>"
import { readFileSync, writeFileSync } from 'node:fs'

const prep = JSON.parse(process.argv[2])
const consoleUrl = process.argv[3]
const links = Object.fromEntries(JSON.parse(readFileSync(prep.file, 'utf8')).map((r) => [r.ref, r.link]))
const pitch = readFileSync('docs/pitch.md', 'utf8').split('\n').filter((l) => /^\| \d+ \|/.test(l)).map((l) => l.split('|')[3].trim())
const S = (id) => `docs/video/slides.html#${id}`
const D = (id) => `docs/video/demo-slides.html#${id}`
const A = links[prep.clip], B = links[prep.walkthrough]
const form = (name, cc) => ['waitfor:#legalName', `fill:#legalName=${name}`, `fill:#taxCountry=${cc}`, `fill:#formSignedAs=${name}`, 'click:#cta', 'waitfor:text=Paperwork sent']
const clearFromConsole = (ref) => [`goto:${consoleUrl}`, `waitfor:[data-clear="${ref}"]`, 'wait:400', `click:[data-clear="${ref}"]`, 'waitfor:.bind.match', 'fill:#dlgNote=identity document checked', 'wait:900', 'click:#dlgOk', 'wait:4500']

const pitchScenes = [
  // hidden: register + sign paperwork before the camera rolls (trimmed), so the video opens on "Account ready"
  { id: 'p00', hidden: true, url: A, passkey: true, actions: ['waitfor:.chip', 'click:#cta', 'waitfor:#registered', 'click:#cta', ...form('Kenji Mori', 'JP'), `goto:${A}`, 'waitfor:#registered'] },
  { id: 'p01', url: A, passkey: true, en: pitch[0], actions: ['waitfor:#registered', 'wait:1500', ...clearFromConsole(prep.clip), `goto:${A}`, 'waitfor:.local'] },
  { id: 'p02', url: S('q'), en: pitch[1] },
  { id: 'p03', url: S('s4'), en: pitch[2] },
  { id: 'p04', url: B, en: pitch[3], actions: ['waitfor:.chip', 'wait:400', 'click:#cta', 'waitfor:#registered', 'wait:700', 'click:#cta', ...form('Ana Souza', 'BR')] },
  { id: 'p05', url: consoleUrl, en: pitch[4], actions: [`waitfor:[data-clear="${prep.forwarded}"]`, 'wait:600', `click:[data-clear="${prep.forwarded}"]`, 'waitfor:.bind.mismatch', 'wait:3500', 'click:dialog .no', 'wait:400', `click:[data-reissue="${prep.forwarded}"]`, 'wait:2500'] },
  { id: 'p06', url: A, en: pitch[5], actions: ['waitfor:.local', 'wait:1500', 'click:#cta', 'wait:600', 'goto:http://localhost:5174/account', 'waitfor:#to', 'fill:#to=0x000000000000000000000000000000000000dEaD', 'fill:#amount=250', 'fill:#memo=DEPOSIT-TAG-77', 'click:#cta', 'waitfor:#sent'] },
  { id: 'p07', url: S('s7'), en: pitch[6] },
  { id: 'p08', url: S('s11'), en: pitch[7] },
  { id: 'p09', url: S('s12'), en: pitch[8] },
  { id: 'p10', url: S('s13'), en: pitch[9] },
]
writeFileSync('docs/video/pitch.json', JSON.stringify(pitchScenes, null, 1))

const demo = [
  ['d1', D('d1'), [], 'This is the attack Claimdesk is built around. A forwarded claim link registers its own account before the real winner. The organizer clears for the address the paperwork names, and the escrow refuses with RecipientMismatch, mined on Tempo testnet. A new link kills the old one, and the real winner is paid. The forwardee gets nothing.'],
  ['d2', D('d2'), [], 'Registration is write-once. The link key signs a domain-tagged digest over the escrow, the chain, the award and the recipient, and the recipient then replaces the link key in the same storage slot. Two slots per award, which matters on Tempo, where every new slot costs two hundred fifty thousand gas.'],
  ['d3', D('d3'), [], 'Clearing must name the account the paperwork names, and pays it in the same call. Withholding can only go to the tax account fixed at deploy, up to a fixed cap, so it cannot become a redirect. Both transfers carry the award reference as their memo.'],
  ['d4', D('d4'), [], 'On the Tempo side: one transaction with batched calls funds every award. The winner\'s passkey is the account. Our relay co-signs as fee payer, and the account page pays its own fees in the stablecoin, because Tempo has no gas token.'],
  ['d5', D('d5'), [], 'The relay answers only the methods a sponsored send needs, and sponsors a single register or claim call into our escrow with mandatory gas and fee caps. It simulates the exact call first, so junk never counts against a winner\'s quota. It runs in its own process with only a small fee-payer key.'],
  ['d6', D('d6'), [], 'The organizer console is local only, behind a loopback check, a host allow-list and a session token. The expected address comes from the winner\'s paperwork, never from the chain; a mismatch blocks clearing. The paperwork note stays local, and only its salted hash goes on-chain.'],
  ['d7', D('d7'), [], 'And the winner\'s side, at phone width: the receipt in their own currency, with a PDF, and the account page that sends on to an exchange deposit address with a tag.'],
]
writeFileSync('docs/video/demo.json', JSON.stringify(demo.map(([id, url, actions, en]) => ({ id, url, en, actions })), null, 1))
console.log('scenes written')
