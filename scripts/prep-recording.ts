/**
 * Stages awards for the screen recordings: funds three awards; a "forwardee" registers the third through its link,
 * and paperwork for the real winner (a different account) arrives — so the console shows the mismatch on camera.
 *   npx tsx scripts/prep-recording.ts  → prints the batch file and refs
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { tempoClient, TempoWinner, viemClaimKeys } from '../src/adapters/tempoEscrow'
import { registerAccount } from '../src/application/payouts'
import { submit } from '../src/infrastructure/paperworkInbox'
import { CHAIN, requireEnv } from '../src/infrastructure/config'
import type { Hex } from '../src/application/ports'

const tag = Date.now().toString(36).slice(-4).toUpperCase()
const refs = [`WF-26-GRAND-${tag}`, `WF-26-TEMPO-${tag}`, `WF-26-UNIV-${tag}`]
writeFileSync('examples/recording.csv', `ref,amount,label\n${refs[0]},15000,Standout team — Kenji Mori\n${refs[1]},10000,Tempo track — Ana Souza\n${refs[2]},5000,University award — Minh Tran\n`)
const out = execFileSync('npx', ['tsx', 'src/infrastructure/cli.ts', 'batch', 'examples/recording.csv'], { encoding: 'utf8' })
const file = out.match(/batches\/\S+\.links\.json/)![0]
const links = Object.fromEntries((JSON.parse(readFileSync(file, 'utf8')) as { ref: string; link: string }[]).map((r) => [r.ref, r.link]))

const feePayer = privateKeyToAccount(requireEnv('FEE_PAYER_KEY_TESTNET') as Hex)
const forwardee = privateKeyToAccount(generatePrivateKey())
await registerAccount(links[refs[2]], forwardee.address, viemClaimKeys, new TempoWinner(tempoClient(CHAIN, forwardee), feePayer), { chainId: CHAIN.id })
const realWinner = privateKeyToAccount(generatePrivateKey())
submit({ ref: refs[2], address: realWinner.address, legalName: 'Minh Tran', taxCountry: 'VN', formSignedAs: 'Minh Tran' })
console.log(JSON.stringify({ file, clip: refs[0], walkthrough: refs[1], forwarded: refs[2], forwardee: forwardee.address, paperworkFor: realWinner.address }))
