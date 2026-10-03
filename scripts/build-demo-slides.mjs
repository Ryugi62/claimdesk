// Regenerates docs/video/demo-slides.html from the CURRENT contract/relay source and the latest Moderato log,
// so the demo can never show stale code. Static sections live in docs/video/demo-static.html.part.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
const sol = readFileSync('contracts/ClaimEscrow.sol', 'utf8')
const grab = (src, start, end = '\n    }\n') => { const i = src.indexOf(start); return src.slice(i, src.indexOf(end, i) + end.length) }
const relay = readFileSync('src/infrastructure/relay.ts', 'utf8')
const spon = grab(relay, 'export function sponsorable', '\n}\n')
const logFile = readdirSync('docs/live').filter((f) => f.startsWith('moderato-')).sort().pop()
const L = Object.fromEntries(JSON.parse(readFileSync(`docs/live/${logFile}`, 'utf8')).log.map((r) => [r.step, r]))
const rows = [
  ['Forwarded link registered first → clear for the real winner', L['F-clear-for-real-winner-refused']],
  ['Old link after a new one is issued', L['F-old-link-refused']],
  ['Same link registers again', L['A-link-reused-after-registration']],
  ['Withholding above the fixed cap', L['G-withholding-above-cap-refused']],
  ['Claim before paperwork', L['B-claim-before-clearance-refused']],
  ['Copied signature, other address', L['E-redirect-refused']],
  ['Claim after expiry', L['D-claim-after-expiry-refused']],
].filter(([, r]) => r)
const tr = rows.map(([a, r]) => `<tr><td>${esc(a)}</td><td><b>${r.error}</b></td><td class="mono">${r.tx.slice(0, 10)}…${r.tx.slice(-6)}</td><td>${r.status}</td></tr>`).join('')
const dynamic = `<section id="d1"><div class="k">The attack, refused on-chain (Tempo Moderato · ${logFile})</div><h2>A forwarded link can’t take the money</h2><table><tr><th>Attempt</th><th>Custom error</th><th>Transaction</th><th>Status</th></tr>${tr}</table></section>
<section id="d2"><div class="k">ClaimEscrow.sol — register is write-once</div><pre>${esc(grab(sol, '    function register('))}</pre></section>
<section id="d3"><div class="k">ClaimEscrow.sol — clear names the account the paperwork names; withholding capped, to a fixed account</div><pre>${esc(grab(sol, '    function clear('))}</pre></section>
`
const d5 = `<section id="d5"><div class="k">Relay policy — pure function, tested</div><pre>${esc(spon)}</pre></section>
`
const tpl = readFileSync('docs/video/demo-static.html.part', 'utf8')
writeFileSync('docs/video/demo-slides.html', tpl.replace('@@DYNAMIC@@', dynamic).replace('@@D5@@', d5))
console.log('demo slides rebuilt from', logFile)
