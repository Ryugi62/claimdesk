// Drives the winner pages and the organizer console in Chromium with virtual WebAuthn authenticators
// (a real passkey ceremony, no human), against `npm run relay` + `npm run console`.
//   node scripts/web-claim.mjs <batches/*.links.json> <REF normal winner> <REF forwarded link> "<console URL with #token=…>"
// Writes screenshots to docs/ui and a log to docs/live/web-<ts>.json.
import { chromium } from 'playwright'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const [linksFile, refA, refF, consoleUrl] = process.argv.slice(2)
const links = Object.fromEntries(JSON.parse(readFileSync(linksFile, 'utf8')).map((r) => [r.ref, r.link]))
const CONSOLE = new URL(consoleUrl).origin
const TOKEN = new URLSearchParams(new URL(consoleUrl).hash.slice(1)).get('token')
const consoleApi = (path, body) => fetch(`${CONSOLE}${path}`, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-console-token': TOKEN }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json())
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
  page.on('dialog', (d) => d.accept())
  return { ctx, page }
}
async function paperwork(page, name, country) {
  await page.waitForSelector('#legalName')
  await page.fill('#legalName', name)
  await page.fill('#taxCountry', country)
  await page.fill('#formSignedAs', name)
  await page.click('#cta')
  await page.waitForSelector('text=Paperwork sent', { timeout: 30000 })
}
/** The organizer clears from the console UI: the address comes from the paperwork inbox, shown in the dialog. */
async function consoleClear(ref) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } })
  await page.goto(consoleUrl)
  await page.waitForSelector(`[data-clear="${ref}"]`, { timeout: 60000 })
  await page.click(`[data-clear="${ref}"]`)
  await page.waitForSelector('.bind')
  const banner = (await page.textContent('#dlgBind')).trim()
  await page.fill('#dlgNote', 'identity document checked')
  await page.screenshot({ path: 'docs/ui/organizer-clear-dialog-1280.png' })
  await page.click('#dlgOk')
  await page.waitForFunction((r) => !document.querySelector(`[data-clear="${r}"]`), ref, { timeout: 60000 })
  await page.close()
  return banner
}

// 1 — normal winner: link → passkey account → paperwork for that account → organizer clears in the console → paid
{
  const { ctx, page } = await phone()
  await page.goto(links[refA])
  await page.waitForSelector('.chip')
  await page.screenshot({ path: 'docs/ui/1-link-opened-390.png' })
  let t0 = Date.now()
  await page.click('#cta')
  await page.waitForSelector('#registered', { timeout: 60000 })
  const address = (await page.textContent('#registered')).trim()
  note('A-registered-with-passkey', { ref: refA, seconds: (Date.now() - t0) / 1000, account: address, tx: await page.getAttribute('#regtx', 'href').catch(() => null) })
  await page.screenshot({ path: 'docs/ui/2-account-ready-390.png' })
  await page.click('#cta') // Complete paperwork
  await paperwork(page, 'Minh Tran', 'VN')
  await page.screenshot({ path: 'docs/ui/3-paperwork-sent-390.png' })
  await page.goto(links[refA]) // back on the award page, which watches for the payment
  await page.waitForSelector('#registered')
  const banner = await consoleClear(refA)
  note('A-console-clear', { banner })
  await page.waitForSelector('text=Received', { timeout: 60000 })
  await page.screenshot({ path: 'docs/ui/4-paid-receipt-390.png' })
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#cta')])
  await dl.saveAs('docs/ui/receipt-sample.pdf')
  note('A-paid', { amount: await page.textContent('.amount'), local: await page.textContent('.local').catch(() => null), tx: await page.getAttribute('dd a', 'href') })
  await page.goto(new URL('/account', links[refA]).toString())
  await page.waitForSelector('#to')
  await page.screenshot({ path: 'docs/ui/5-account-390.png' })
  await page.fill('#to', '0x000000000000000000000000000000000000dEaD')
  await page.fill('#amount', '12.50')
  await page.fill('#memo', 'DEPOSIT-TAG-1234')
  t0 = Date.now()
  await page.click('#cta')
  await page.waitForSelector('#sent', { timeout: 60000 })
  note('A-sent-from-account', { seconds: (Date.now() - t0) / 1000, summary: (await page.textContent('#sent')).trim(), tx: await page.getAttribute('#sent a', 'href') })
  await page.screenshot({ path: 'docs/ui/6-sent-390.png' })
  await ctx.close()
}

// 2 — forwarded link: someone else registers first; the real winner sends paperwork for their own account;
//     the console shows the mismatch; the organizer issues a new link; the winner registers and is paid
{
  const forwardee = await phone()
  await forwardee.page.goto(links[refF])
  await forwardee.page.waitForSelector('.chip')
  await forwardee.page.click('#cta')
  await forwardee.page.waitForSelector('#registered', { timeout: 60000 })
  const intruder = (await forwardee.page.textContent('#registered')).trim()
  note('F-forwardee-registered-first', { ref: refF, account: intruder })
  await forwardee.ctx.close()

  const winner = await phone()
  await winner.page.goto(links[refF])
  await winner.page.waitForSelector('#notmine', { timeout: 60000 })
  await winner.page.screenshot({ path: 'docs/ui/7-not-my-registration-390.png' })
  await winner.page.click('#cta') // That wasn't me — send my paperwork
  await paperwork(winner.page, 'Ana Souza', 'BR')
  const status = await consoleApi('/api/status')
  const row = status.rows.find((r) => r.ref === refF)
  note('F-console-sees', { registered: row.registered, paperworkFor: row.paperwork?.address, binding: row.binding })
  const cpage = await browser.newPage({ viewport: { width: 1280, height: 860 } })
  await cpage.goto(consoleUrl)
  await cpage.waitForSelector('.row')
  await cpage.screenshot({ path: 'docs/ui/organizer-mismatch-1280.png', fullPage: true })
  await cpage.click(`[data-clear="${refF}"]`)
  await cpage.waitForSelector('.bind.mismatch')
  await cpage.screenshot({ path: 'docs/ui/organizer-mismatch-dialog-1280.png' })
  await cpage.click('dialog .no')
  await cpage.close()
  const re = await consoleApi('/api/reissue', { ref: refF })
  note('F-organizer-reissued', { tx: re.tx })
  await winner.page.goto(re.link)
  await winner.page.waitForSelector('.chip')
  await winner.page.click('#cta') // Use my account (the passkey made for the paperwork)
  await winner.page.waitForSelector('#registered', { timeout: 60000 })
  const now = (await winner.page.textContent('#registered')).trim()
  const banner = await consoleClear(refF)
  await winner.page.waitForSelector('text=Received', { timeout: 60000 }) // the page notices the payment by itself
  note('F-winner-paid', { account: now, intruder, banner, tx: await winner.page.getAttribute('dd a', 'href') })
  await winner.ctx.close()
}

// organizer console at both widths; outsiders refused
for (const [w, h] of [[1280, 800], [390, 844]]) {
  const page = await browser.newPage({ viewport: { width: w, height: h } })
  await page.goto(consoleUrl)
  await page.waitForSelector('.row')
  const clipped = await page.evaluate(() => [...document.querySelectorAll('.row, .row *')].some((el) => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== 'visible'))
  note(`console-${w}`, { horizontalOverflow: await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), clippedContent: clipped })
  await page.screenshot({ path: `docs/ui/organizer-console-${w}.png`, fullPage: true })
}
note('console-without-token', { status: await fetch(`${CONSOLE}/api/status`).then((r) => r.status) })
await browser.close()
mkdirSync('docs/live', { recursive: true })
const file = `docs/live/web-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
writeFileSync(file, JSON.stringify({ authenticator: 'Chromium virtual WebAuthn authenticator (CTAP2, internal, user-verified)', log }, null, 2))
console.log('written', file)
