// Drives the winner pages in Chromium with a virtual WebAuthn authenticator (a real passkey ceremony, no human),
// against the organizer server (npm run serve). Writes screenshots to docs/ui and a log to docs/live/web-<ts>.json.
//   node scripts/web-claim.mjs <batches/*.links.json> <REF registers early> <REF already cleared>
import { chromium } from 'playwright'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const [linksFile, earlyRef, clearedRef] = process.argv.slice(2)
const links = Object.fromEntries(JSON.parse(readFileSync(linksFile, 'utf8')).map((r) => [r.ref, r.link]))
const BASE = new URL(links[earlyRef]).origin
mkdirSync('docs/ui', { recursive: true })
const log = []
const note = (step, data) => { const row = { step, ...data }; log.push(row); console.log(JSON.stringify(row)) }

const browser = await chromium.launch()
async function phone() {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ko-KR', deviceScaleFactor: 2, acceptDownloads: true })
  const page = await ctx.newPage()
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('WebAuthn.enable')
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } })
  page.on('pageerror', (e) => console.log('[pageerror]', e.message))
  return { ctx, page }
}

// path A — open the link early, create the account; organizer clears; money arrives without a second visit
{
  const { ctx, page } = await phone()
  await page.goto(links[earlyRef])
  await page.waitForSelector('.chip')
  await page.screenshot({ path: 'docs/ui/1-link-opened-390.png' })
  let t0 = Date.now()
  await page.click('#cta')
  await page.waitForSelector('.addr', { timeout: 60000 })
  const address = (await page.textContent('.addr')).trim()
  note('registered', { ref: earlyRef, seconds: (Date.now() - t0) / 1000, account: address })
  await page.screenshot({ path: 'docs/ui/2-account-ready-390.png' })
  const clr = await (await fetch(`${BASE}/api/clear`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ref: earlyRef, paperwork: 'W-8BEN received, identity checked, prize acceptance signed' }) })).json()
  note('organizer-cleared', { ref: earlyRef, tx: clr.tx })
  await page.reload()
  await page.waitForSelector('text=Received', { timeout: 60000 })
  await page.screenshot({ path: 'docs/ui/3-paid-receipt-390.png' })
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#cta')])
  await dl.saveAs('docs/ui/receipt-sample.pdf')
  note('receipt', { amount: await page.textContent('.amount'), local: await page.textContent('.local').catch(() => null), pdf: 'docs/ui/receipt-sample.pdf', tx: (await page.getAttribute('dd a', 'href')) })
  // account page: balance + send to an exchange-style address with a memo, fee paid in the stablecoin itself
  await page.goto(`${BASE}/account`)
  await page.waitForSelector('#to')
  await page.screenshot({ path: 'docs/ui/4-account-390.png' })
  await page.fill('#to', '0x000000000000000000000000000000000000dEaD')
  await page.fill('#amount', '12.50')
  await page.fill('#memo', 'DEPOSIT-TAG-1234')
  t0 = Date.now()
  await page.click('#cta')
  await page.waitForSelector('text=Sent', { timeout: 60000 })
  note('sent-from-account', { seconds: (Date.now() - t0) / 1000, tx: await page.getAttribute('.chip a', 'href'), balanceAfter: await page.textContent('.amount') })
  await page.screenshot({ path: 'docs/ui/5-sent-390.png' })
  await ctx.close()
}

// path B — a winner who never opened the link before clearance: receive now with a new passkey
{
  const { ctx, page } = await phone()
  await page.goto(links[clearedRef])
  await page.waitForSelector('.chip')
  const t0 = Date.now()
  await page.click('#cta')
  await page.waitForSelector('text=Received', { timeout: 60000 })
  note('bearer-claim', { ref: clearedRef, seconds: (Date.now() - t0) / 1000, unit: await page.textContent('.unit'), tx: await page.getAttribute('dd a', 'href') })
  await ctx.close()
}

// organizer console
for (const [w, h] of [[1280, 800], [390, 844]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } })
  await page.goto(`${BASE}/`)
  await page.waitForSelector('tbody tr')
  note(`console-${w}`, { horizontalOverflow: await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth) })
  await page.screenshot({ path: `docs/ui/organizer-console-${w}.png` })
}
await browser.close()
mkdirSync('docs/live', { recursive: true })
const file = `docs/live/web-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
writeFileSync(file, JSON.stringify({ base: BASE, authenticator: 'Chromium virtual WebAuthn authenticator (CTAP2, internal, user-verified)', log }, null, 2))
console.log('written', file)
