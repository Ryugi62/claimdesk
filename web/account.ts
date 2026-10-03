import { isAddress, parseUnits, pad, stringToHex } from 'viem'
import { balanceOf, tokenMeta, tip20Abi } from '../src/adapters/tempoEscrow'
import { loadConfig, readClient, selfPayClient, savedPasskey, signInWithPasskey, accountOf, esc, money, type Config } from './common'
import type { Hex } from '../src/application/ports'

const app = document.getElementById('app')!
const cta = document.getElementById('cta') as HTMLButtonElement
const PATH_USD = '0x20c0000000000000000000000000000000000000' as Hex

async function main() {
  const cfg = await loadConfig()
  const p = savedPasskey()
  if (!p) {
    app.innerHTML = `<div class="program">Claimdesk</div><h1>Your account</h1><p>Sign in with the passkey you used to receive your award.</p>`
    cta.textContent = 'Sign in with my passkey'
    cta.disabled = false
    cta.onclick = async () => {
      cta.disabled = true
      try { await signInWithPasskey(); await show(cfg) } catch (e) { cta.disabled = false; app.insertAdjacentHTML('beforeend', `<p class="err">${esc((e as Error).message)}</p>`) }
    }
    return
  }
  await show(cfg)
}

async function show(cfg: Config) {
  const account = accountOf(savedPasskey()!)
  const client = readClient(cfg)
  const meta = await tokenMeta(client, PATH_USD)
  const bal = await balanceOf(client, PATH_USD, account.address as Hex)
  app.innerHTML = `<div class="program">Your account · Tempo</div><div class="amount">$${money(bal, meta.decimals)}</div><div class="unit">${esc(meta.symbol)} on Tempo</div><div class="addr">${esc(account.address)}</div>
  <div class="card"><div class="program">Send</div>
    <label>To (exchange deposit address or wallet)<input id="to" placeholder="0x…" autocomplete="off"></label>
    <label>Amount<input id="amount" inputmode="decimal" placeholder="0.00"></label>
    <label>Memo or deposit tag (if your exchange asks for one)<input id="memo" maxlength="31" placeholder="optional"></label>
    <p class="hint">The network fee (a fraction of a cent) is paid in ${esc(meta.symbol)} from this balance — there is no separate gas token on Tempo.</p>
  </div>
  <details><summary>Where this money lives</summary><p>This account is controlled only by the passkey on your device. Claimdesk and the organizer cannot move it. To cash out, send it to an exchange that supports ${esc(meta.symbol)} on Tempo, or to any Tempo wallet.</p></details>`
  cta.textContent = 'Send'
  cta.disabled = false
  cta.onclick = async () => {
    const to = (document.getElementById('to') as HTMLInputElement).value.trim()
    const amountText = (document.getElementById('amount') as HTMLInputElement).value.trim()
    const memoText = (document.getElementById('memo') as HTMLInputElement).value.trim()
    try {
      if (!isAddress(to)) throw new Error('Enter a valid 0x address.')
      const amount = parseUnits(amountText || '0', meta.decimals)
      if (amount <= 0n || amount > bal) throw new Error('Enter an amount up to your balance.')
      cta.disabled = true
      cta.textContent = 'Waiting for your fingerprint or face…'
      const wallet = selfPayClient(cfg, account)
      const receipt = await wallet.writeContractSync({
        address: PATH_USD, abi: tip20Abi, functionName: 'transferWithMemo',
        args: [to as Hex, amount, memoText ? pad(stringToHex(memoText), { dir: 'right', size: 32 }) : pad('0x', { size: 32 })],
        account, chain: wallet.chain, feeToken: PATH_USD,
      } as never) as { transactionHash: Hex }
      await show(cfg)
      app.insertAdjacentHTML('afterbegin', `<span class="chip ok">Sent · <a href="${esc(cfg.explorer)}/tx/${esc(receipt.transactionHash)}" target="_blank" rel="noopener">view</a></span>`)
    } catch (e) {
      cta.disabled = false
      cta.textContent = 'Send'
      app.insertAdjacentHTML('beforeend', `<p class="err">${esc((e as Error).message.split('\n')[0])}</p>`)
    }
  }
}

main().catch((e) => { app.innerHTML = `<p class="err">${esc((e as Error).message)}</p>` })
