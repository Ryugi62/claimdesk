import { Account } from 'viem/tempo'
import { generatePrivateKey } from 'viem/accounts'
import { isAddress } from 'viem'
import { parseClaimLink, isKnownEscrow } from '../src/domain/claimLink'
import { awardMemo } from '../src/domain/memo'
import { describe as describeStatus } from '../src/domain/status'
import { registerAccount, claimAward, receiptFor } from '../src/application/payouts'
import { viemClaimKeys, TempoWinner, readAward, tokenMeta, escrowEvents } from '../src/adapters/tempoEscrow'
import { EcbRates } from '../src/adapters/ecbRates'
import { loadConfig, readClient, sponsoredClient, savedPasskey, createPasskey, signInWithPasskey, accountOf, esc, money, short, localCurrency, type Config } from './common'
import { receiptPdf, download } from './receiptPdf'
import type { Hex } from '../src/application/ports'

const app = document.getElementById('app')!
const cta = document.getElementById('cta') as HTMLButtonElement

function button(label: string, onClick: () => Promise<void>, enabled = true) {
  cta.textContent = label
  cta.disabled = !enabled
  cta.onclick = async () => {
    cta.disabled = true
    try {
      await onClick()
    } catch (e) {
      cta.disabled = false
      cta.textContent = 'Try again'
      app.insertAdjacentHTML('beforeend', `<p class="err">${esc((e as Error).message.split('\n')[0])}</p>`)
    }
  }
}

async function main() {
  let link
  try {
    link = parseClaimLink(location.href)
  } catch (e) {
    app.innerHTML = `<div class="program">Claimdesk</div><h1>This link doesn't work</h1><p class="err">${esc((e as Error).message)}</p><p>Ask the organizer to send your link again.</p>`
    cta.style.display = 'none'
    return
  }
  const cfg = await loadConfig()
  if (cfg.chainId !== link.chainId) throw new Error(`This page serves chain ${cfg.chainId}; the link is for chain ${link.chainId}.`)
  if (!isKnownEscrow(cfg.escrows, link.escrow)) {
    app.innerHTML = `<div class="program">${esc(cfg.program)}</div><h1>This link isn't from this program</h1><p class="err">It points at a contract (${esc(short(link.escrow))}) that ${esc(cfg.program)} did not set up. Don't sign anything — ask the organizer for your link through their official channel.</p>`
    cta.style.display = 'none'
    return
  }
  await render(cfg, link.escrow as Hex, link.ref)
}

async function render(cfg: Config, escrow: Hex, ref: string) {
  const client = readClient(cfg)
  const id = awardMemo(ref)
  const award = await readAward(client, escrow, id)
  if (award.status === 'None') {
    app.innerHTML = `<div class="program">${esc(cfg.program)}</div><h1>Award not found</h1><p>Check the link with the organizer.</p>`
    cta.style.display = 'none'
    return
  }
  const meta = await tokenMeta(client, award.token)
  const registered = award.registered
  const mine = savedPasskey()
  const myAddress = mine ? accountOf(mine).address : undefined
  const isMine = (a?: string) => !!a && !!myAddress && a.toLowerCase() === myAddress.toLowerCase()
  const head = `<div class="program">${esc(cfg.program)}</div><div class="amount">$${money(award.amount, meta.decimals)}</div><div class="unit">US dollars (stablecoin) · award ${esc(ref)}</div>`
  const d = describeStatus({ status: award.status })
  const chip = { Funded: 'Locked for you', Registered: 'Account ready', Cleared: 'Paperwork approved', Claimed: 'Paid', Expired: 'Expired', Reclaimed: 'Returned', Revoked: 'Cancelled' }[award.status as string] ?? 'Check with the organizer'
  const how = `<details><summary>How this works</summary><p>A passkey is the fingerprint or face unlock on this device. It becomes your account on the Tempo network — no app, no seed phrase. The organizer pays the network fee. The money is already locked for you, and it moves only after the organizer approves your paperwork.</p></details>`
  const expires = `<p>Set aside until ${esc(new Date(award.expiresAt * 1000).toUTCString().replace(/:\d\d GMT/, ' UTC'))}.</p>`

  const events = award.status === 'Claimed' || award.status === 'Registered' || award.status === 'Funded' ? await escrowEvents(client, escrow, BigInt(cfg.escrows?.[escrow.toLowerCase()] ?? 0), id).catch(() => []) : []
  if (award.status === 'Claimed') {
    const paid = events.find((e) => e.kind === 'Claimed')
    const cleared = events.find((e) => e.kind === 'Cleared')
    const withheld = cleared && cleared.kind === 'Cleared' ? cleared.withheld : undefined
    if (paid && paid.kind === 'Claimed' && isMine(paid.recipient)) return showReceipt(cfg, escrow, ref, paid.txHash as Hex, paid.recipient as Hex, paid.amount ?? award.amount, meta, undefined, withheld)
    app.innerHTML = `${head}<span class="chip ok">${chip}</span><p>This award was paid to ${esc(short(paid && paid.kind === 'Claimed' ? paid.recipient : ''))}.</p><p>On the device that received it, open <a href="account">your account</a>.</p>`
    cta.style.display = 'none'
    return
  }
  app.innerHTML = `${head}<span class="chip ${d.tone}">${chip}</span><p>${esc(d.winner)}</p>${['Funded', 'Registered', 'Cleared'].includes(award.status) ? expires : ''}${how}`

  if (award.status === 'Funded' && events.some((e) => e.kind === 'LinkReissued')) {
    app.insertAdjacentHTML('afterbegin', `<span class="chip warn">The organizer issued a new link for this award</span>`)
  }
  const getAccount = async () => accountOf(savedPasskey() ?? (await createPasskey(`Claimdesk ${ref}`)))
  if (award.status === 'Funded') {
    app.insertAdjacentHTML('beforeend', `<p class="alt"><a href="#" id="existing">I already have an address</a>${mine ? '' : ' · <a href="#" id="signin">Use a passkey I made before</a>'}</p>`)
    document.getElementById('signin')?.addEventListener('click', async (e) => { e.preventDefault(); await signInWithPasskey(); await render(cfg, escrow, ref) })
    document.getElementById('existing')!.addEventListener('click', async (e) => {
      e.preventDefault()
      const to = prompt('Your Tempo or EVM address (0x…). The award will be paid there when your paperwork is approved.')?.trim()
      if (!to) return
      if (!isAddress(to)) return alert('That is not an address.')
      cta.disabled = true
      const sender = Account.fromSecp256k1(generatePrivateKey()) // throwaway sender; the claim key decides, the sponsor pays
      const tx = await registerAccount(location.href, to as Hex, viemClaimKeys, new TempoWinner(sponsoredClient(cfg, sender) as never, true), { chainId: cfg.chainId })
      remember(escrow, ref, tx.hash)
      await render(cfg, escrow, ref)
    })
    button(mine ? 'Use my account' : 'Create my account', async () => {
      cta.textContent = 'Waiting for your fingerprint or face…'
      const account = await getAccount()
      cta.textContent = 'Saving…'
      const tx = await registerAccount(location.href, account.address as Hex, viemClaimKeys, new TempoWinner(sponsoredClient(cfg, account) as never, true), { chainId: cfg.chainId })
      remember(escrow, ref, tx.hash)
      await render(cfg, escrow, ref)
    })
    return
  }
  if (award.status === 'Registered' && registered) {
    const reg = events.find((e) => e.kind === 'Registered' || e.kind === 'RecipientChanged')
    const regTx = reg?.txHash ?? recalled(escrow, ref)
    app.insertAdjacentHTML('beforeend', `<div class="card"><div class="program">Your account</div><div class="addr" id="registered">${esc(registered)}</div><p>Next: complete the paperwork for this account. The organizer approves it for this address, and the payment goes nowhere else.</p>${regTx ? `<p class="alt">Registered on-chain: <a id="regtx" href="${esc(cfg.explorer)}/tx/${esc(regTx)}" target="_blank" rel="noopener">${esc(short(regTx))}</a></p>` : ''}</div>`)
    const scheduled = [...events].reverse().find((e) => e.kind === 'ReissueScheduled')
    const reissuedSince = scheduled && events.indexOf(scheduled) < events.length - 1 && events.slice(events.indexOf(scheduled) + 1).some((e) => e.kind === 'LinkReissued')
    if (scheduled && scheduled.kind === 'ReissueScheduled' && !reissuedSince) {
      app.insertAdjacentHTML('afterbegin', `<span class="chip warn">The organizer scheduled a new link for this award${scheduled.notBefore ? ` (after ${esc(new Date(scheduled.notBefore * 1000).toUTCString().replace(/:\d\d GMT/, ' UTC'))})` : ''} — if that's unexpected, contact them now</span>`)
    }
    if (isMine(registered)) {
      const url = (cfg.paperworkUrl ?? 'paperwork?ref={ref}&address={address}').replace('{ref}', encodeURIComponent(ref)).replace('{address}', registered)
      app.insertAdjacentHTML('beforeend', `<p class="alt"><a href="account">Open my account</a> · <a href="#" id="move">Pay a different account of mine</a></p>`)
      document.getElementById('move')!.addEventListener('click', async (e) => {
        e.preventDefault()
        const to = prompt('Another Tempo or EVM address you control. Only this account (signed by your passkey) can make this change, and only before the organizer approves your paperwork.')?.trim()
        if (!to) return
        if (!isAddress(to)) return alert('That is not an address.')
        const account = accountOf(savedPasskey()!)
        await new TempoWinner(sponsoredClient(cfg, account) as never, true).changeRecipient(escrow, id, to as Hex)
        await render(cfg, escrow, ref)
      })
      button('Complete paperwork', async () => { location.href = url })
      // paid automatically on clearance — watch for it and switch to the receipt by itself
      const watch = setInterval(async () => {
        const now = await readAward(client, escrow, id).catch(() => undefined)
        if (now && now.status !== 'Registered') { clearInterval(watch); await render(cfg, escrow, ref) }
      }, 4000)
    } else {
      app.insertAdjacentHTML('beforeend', `<p class="err" id="notmine">This award is registered to an account this device does not hold. If that was not you, send your paperwork for your own account: the organizer will see that it does not match, and issue you a new link before paying anyone.</p>`)
      button("That wasn't me — send my paperwork", async () => {
        cta.textContent = 'Waiting for your fingerprint or face…'
        const mineNow = accountOf(savedPasskey() ?? (await createPasskey(`Claimdesk ${ref}`)))
        location.href = (cfg.paperworkUrl ?? 'paperwork?ref={ref}&address={address}').replace('{ref}', encodeURIComponent(ref)).replace('{address}', mineNow.address)
      })
    }
    return
  }
  if (award.status === 'Cleared') {
    button(mine ? 'Receive to my account' : 'Receive with a passkey', async () => {
      cta.textContent = 'Waiting for your fingerprint or face…'
      const account = await getAccount()
      cta.textContent = 'Receiving…'
      const t0 = performance.now()
      const tx = await claimAward(location.href, account.address as Hex, viemClaimKeys, new TempoWinner(sponsoredClient(cfg, account) as never, true), { chainId: cfg.chainId })
      await showReceipt(cfg, escrow, ref, tx.hash, account.address as Hex, award.amount, meta, Math.round(performance.now() - t0))
    })
    return
  }
  cta.style.display = 'none'
}

function remember(escrow: string, ref: string, tx: string) {
  try { localStorage.setItem(`claimdesk:reg:${escrow.toLowerCase()}:${ref}`, tx) } catch { /* private mode */ }
}
function recalled(escrow: string, ref: string): string | undefined {
  try { return localStorage.getItem(`claimdesk:reg:${escrow.toLowerCase()}:${ref}`) ?? undefined } catch { return undefined }
}

async function showReceipt(cfg: Config, escrow: Hex, ref: string, txHash: Hex, recipient: Hex, amount: bigint, meta: { symbol: string; decimals: number }, ms?: number, withheld?: bigint) {
  const client = readClient(cfg)
  const r = await client.getTransactionReceipt({ hash: txHash })
  const block = await client.getBlock({ blockNumber: r.blockNumber })
  const receipt = await receiptFor({ ref, amount, decimals: meta.decimals, symbol: meta.symbol, tx: { hash: txHash, blockTime: new Date(Number(block.timestamp) * 1000) }, memo: awardMemo(ref), recipient, withheld }, new EcbRates(), localCurrency())
  const explorerUrl = `${cfg.explorer}/tx/${txHash}`
  const local = receipt.local ? `<div class="card"><div class="program">For your records</div><div class="local">≈ ${esc(receipt.local.amountText)} ${esc(receipt.local.currency)}</div><p>USD/${esc(receipt.local.currency)} cross rate from the ECB reference rates of ${esc(receipt.local.rateDate)} (1 USD = ${Number(receipt.local.rate).toLocaleString('en-US')} ${esc(receipt.local.currency)}). Your tax office may require its own official rate.</p></div>` : ''
  app.innerHTML = `<div class="program">${esc(cfg.program)}</div><div class="amount">$${esc(receipt.amountText)}</div><div class="unit">US dollars received${ms ? ` in ${(ms / 1000).toFixed(1)} s` : ''} · network fee paid by the organizer</div>
  <span class="chip ok">Received</span>${receipt.withholding ? `<p>Award $${esc(receipt.withholding.grossText)} − $${esc(receipt.withholding.withheldText)} tax withheld at source by the organizer.</p>` : ''}${local}
  <p class="alt"><a href="account">Open my account</a> — move it to your own wallet or an exchange that accepts Tempo deposits.</p>
  <details><summary>Receipt details</summary><dl>
    <dt>Award</dt><dd>${esc(receipt.memoText)}</dd>
    <dt>Time (UTC)</dt><dd>${esc(receipt.blockTimeUtc)}</dd>
    <dt>Your account</dt><dd>${esc(receipt.recipient)}</dd>
    <dt>Transaction</dt><dd><a href="${esc(explorerUrl)}" target="_blank" rel="noopener">${esc(receipt.txHash)}</a></dd>
    <dt>Memo</dt><dd>${esc(receipt.memo)}</dd>
    ${receipt.local ? `<dt>Rate source</dt><dd>${esc(receipt.local.source)}. 1 ${esc(receipt.symbol)} is treated as 1 USD.</dd>` : ''}
  </dl></details>`
  button('Download receipt (PDF)', async () => {
    const organizer = (await client.readContract({ address: escrow, abi: [{ type: 'function', name: 'organizer', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] }] as const, functionName: 'organizer' })) as string
    download(await receiptPdf(receipt, { program: cfg.program, organizer, explorerUrl, chain: `Tempo (chain ${cfg.chainId})` }), `receipt-${receipt.memoText}.pdf`)
    cta.disabled = false
    cta.textContent = 'Download receipt (PDF)'
  })
}

// a different link opened in the same tab (only the fragment changes) → start over with the new link
addEventListener('hashchange', () => location.reload())

main().catch((e) => {
  app.innerHTML = `<p class="err">${esc((e as Error).message.split('\n')[0])}</p>`
})
