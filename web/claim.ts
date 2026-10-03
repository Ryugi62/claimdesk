import { createClient, http, publicActions, walletActions } from 'viem'
import { tempoModerato } from 'viem/chains'
import { Account, WebAuthnP256, withRelay, tempoActions } from 'viem/tempo'
import { parseClaimLink } from '../src/domain/claimLink'
import { formatUnits } from '../src/domain/receipt'
import { claimAward } from '../src/application/payouts'
import { viemClaimKeys, SponsoredClaimSubmitter } from '../src/adapters/tempoEscrow'
import type { Hex } from '../src/application/ports'

const app = document.getElementById('app')!
const cta = document.getElementById('cta') as HTMLButtonElement
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const money = (base: string | bigint) => Number(formatUnits(BigInt(base), 6)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const LOCAL: Record<string, string> = { ko: 'KRW', ja: 'JPY', hi: 'INR', vi: 'VND', id: 'IDR', th: 'THB', de: 'EUR', fr: 'EUR', es: 'EUR', it: 'EUR', pt: 'BRL', tr: 'TRY', pl: 'PLN', 'en-GB': 'GBP', 'en-IN': 'INR', 'en-PH': 'PHP' }
const localCurrency = new URLSearchParams(location.search).get('currency') ?? LOCAL[navigator.language] ?? LOCAL[navigator.language.slice(0, 2)] ?? 'USD'

interface Award { ref: string; status: string; amount: string; symbol: string; expiresAt: number; program: string }

async function main() {
  let link
  try {
    link = parseClaimLink(location.href)
  } catch (e) {
    app.innerHTML = `<div class="program">Claimdesk</div><h1>This link doesn't work</h1><p class="err">${esc((e as Error).message)}</p><p>Ask the organizer to send your link again.</p>`
    return
  }
  const cfg = await (await fetch('/api/config')).json()
  const award: Award = await (await fetch(`/api/award?ref=${encodeURIComponent(link.ref)}`)).json()
  const head = `<div class="program">${esc(award.program)}</div><div class="amount">$${money(award.amount)}</div><div class="unit">${esc(award.symbol)} · award ${esc(award.ref)}</div>`
  const how = `<details><summary>How this works</summary><p>A passkey is the fingerprint or face unlock on this device. It becomes your account on the Tempo network — no app, no seed phrase. The organizer pays the network fee, and the money only moves after they approved your paperwork.</p></details>`
  const saved = localStorage.getItem(`claimdesk:${link.escrow}:${link.ref}`)
  if (award.status === 'Claimed' && saved) return showReceipt(link.ref, JSON.parse(saved).tx, JSON.parse(saved).ms)
  const state: Record<string, [string, string, string]> = {
    Cleared: ['ok', 'Paperwork approved — ready to receive', 'is ready. Receive it in one step.'],
    Funded: ['warn', 'The organizer is still checking your paperwork', 'is set aside for you. Come back to this link once your paperwork is approved.'],
    Claimed: ['no', 'Already received', 'was already received with this link.'],
    Expired: ['no', 'This award expired', 'was not received in time. Contact the organizer.'],
    Reclaimed: ['no', 'Returned to the organizer', 'expired and went back to the organizer.'],
    None: ['no', 'Award not found', 'could not be found. Check the link with the organizer.'],
  }
  const [tone, chip, line] = state[award.status] ?? state.None
  app.innerHTML = `${head}<span class="chip ${tone}">${chip}</span><p>Your award ${line}</p>${how}`
  if (award.status !== 'Cleared') return
  cta.disabled = false
  cta.onclick = async () => {
    cta.disabled = true
    cta.textContent = 'Waiting for your fingerprint or face…'
    try {
      const credential = await WebAuthnP256.createCredential({ label: `Claimdesk ${award.ref}` } as never)
      const account = Account.fromWebAuthnP256(credential)
      localStorage.setItem(`claimdesk:passkey:${credential.id}`, credential.publicKey)
      cta.textContent = 'Receiving…'
      const client = createClient({ chain: tempoModerato, account, transport: withRelay(http(cfg.rpc), http('/relay')) }).extend(publicActions).extend(walletActions).extend(tempoActions())
      const t0 = performance.now()
      const tx = await claimAward(location.href, account.address as Hex, viemClaimKeys, new SponsoredClaimSubmitter(client as never, true), { chainId: cfg.chainId })
      const ms = Math.round(performance.now() - t0)
      localStorage.setItem(`claimdesk:${link.escrow}:${link.ref}`, JSON.stringify({ tx: tx.hash, ms, account: account.address }))
      await showReceipt(link.ref, tx.hash, ms)
    } catch (e) {
      cta.disabled = false
      cta.textContent = 'Try again'
      app.insertAdjacentHTML('beforeend', `<p class="err">${esc((e as Error).message.split('\n')[0])}</p>`)
    }
  }
}

async function showReceipt(ref: string, tx: string, ms?: number) {
  const r = await (await fetch(`/api/receipt?ref=${encodeURIComponent(ref)}&tx=${tx}&currency=${localCurrency}`)).json()
  const local = r.local ? `<div class="local">≈ ${esc(r.local.amountText)} ${esc(r.local.currency)}</div><p>at the ECB reference rate of ${esc(r.local.rateDate)} (1 USD = ${r.local.rate} ${esc(r.local.currency)})</p>` : ''
  app.innerHTML = `<div class="program">${esc(r.program)}</div><div class="amount">$${esc(r.amountText)}</div><div class="unit">${esc(r.symbol)} received${ms ? ` in ${(ms / 1000).toFixed(1)} s` : ''} · network fee paid by the organizer</div>
  <span class="chip ok">Received</span>
  ${r.local ? `<div class="card"><div class="program">For your records</div>${local}</div>` : ''}
  <details><summary>Receipt details</summary><dl>
    <dt>Award</dt><dd>${esc(r.memoText)}</dd>
    <dt>Time (UTC)</dt><dd>${esc(r.blockTimeUtc)}</dd>
    <dt>Your account</dt><dd>${esc(r.recipient)}</dd>
    <dt>Transaction</dt><dd><a href="${esc(r.explorer)}" target="_blank" rel="noopener">${esc(r.txHash)}</a></dd>
    <dt>Memo</dt><dd>${esc(r.memo)}</dd>
    ${r.local ? `<dt>Rate source</dt><dd>${esc(r.local.source)}</dd>` : ''}
  </dl></details>`
  cta.disabled = false
  cta.textContent = 'Download receipt'
  cta.onclick = () => {
    const blob = new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `receipt-${r.memoText}.json`
    a.click()
  }
}

main().catch((e) => { app.innerHTML = `<p class="err">${esc((e as Error).message)}</p>` })
