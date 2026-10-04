import { awardMemo } from '../src/domain/memo'
import { paperworkDigest, paperworkRecordHash as recordHash } from '../src/adapters/tempoEscrow'
import { loadConfig, savedPasskey, accountOf, esc } from './common'
import type { Hex } from '../src/application/ports'


const q = new URLSearchParams(location.search)
const ref = q.get('ref') ?? ''
const address = q.get('address') ?? ''
for (const [k, v] of [['ref', ref], ['address', address]]) (document.getElementById(k) as HTMLInputElement).value = v
const cta = document.getElementById('cta') as HTMLButtonElement
const msg = document.getElementById('msg')!

cta.onclick = async () => {
  try {
    const cfg = await loadConfig()
    const mine = savedPasskey()
    const account = mine ? accountOf(mine) : undefined
    if (!account || account.address.toLowerCase() !== address.toLowerCase()) throw new Error('Open this form from the device that holds the payout account — your passkey signs the paperwork.')
    const f = {
      ref,
      address,
      legalName: (document.getElementById('legalName') as HTMLInputElement).value.trim(),
      taxCountry: (document.getElementById('taxCountry') as HTMLInputElement).value.trim().toUpperCase(),
      formSignedAs: (document.getElementById('formSignedAs') as HTMLInputElement).value.trim(),
    }
    const escrow = Object.keys(cfg.escrows ?? {})[0] as Hex
    cta.disabled = true
    cta.textContent = 'Sign with your fingerprint or face…'
    const signature = await account.sign({ hash: paperworkDigest(escrow, cfg.chainId, awardMemo(ref), address as Hex, recordHash(f)) })
    const r = await fetch('api/paperwork', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...f, signature }) })
    if (r.status === 404 || r.status === 405) throw new Error("This page is hosted without the organizer's paperwork service, so nothing was sent. In a real program the organizer runs it (npm run relay) or points paperworkUrl at their KYC provider.")
    const out = await r.json()
    if (!r.ok) throw new Error(out.error)
    document.getElementById('f')?.remove()
    msg.className = ''
    msg.innerHTML = '<span class="chip ok">Paperwork sent — signed by your account</span><p>Your organizer approves it for this account and you are paid automatically. You can go back to your award page.</p>'
    cta.textContent = 'Back to my award'
    cta.disabled = false
    cta.onclick = () => history.back()
  } catch (e) {
    cta.disabled = false
    cta.textContent = 'Sign and submit paperwork'
    msg.className = 'err'
    msg.textContent = esc((e as Error).message.split('\n')[0])
  }
}
