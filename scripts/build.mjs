// Static build of the winner pages (claim + account) for any static host.
// node scripts/build.mjs [--out dist] [--sponsor https://sponsor.moderato.tempo.xyz] [--program "…"] [--escrow 0x…:block]…
import { build } from 'esbuild'
import { cpSync, mkdirSync, writeFileSync } from 'node:fs'
import { tempoModerato } from 'viem/chains'

const argv = process.argv.slice(2)
const opt = (k, d) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d)
const OUT = opt('out', 'dist')
mkdirSync(OUT, { recursive: true })
await build({ entryPoints: ['web/claim.ts', 'web/account.ts'], outdir: OUT, bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true, define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'warning' })
for (const f of ['claim.html', 'account.html', 'paperwork.html', 'style.css', 'logo.svg']) cpSync(`web/${f}`, `${OUT}/${f}`)
const escrows = Object.fromEntries(argv.flatMap((a, i) => (a === '--escrow' ? [argv[i + 1].toLowerCase().split(':')] : [])).map(([a, b]) => [a, Number(b)]))
writeFileSync(`${OUT}/config.json`, JSON.stringify({
  chainId: tempoModerato.id,
  rpc: tempoModerato.rpcUrls.default.http[0],
  sponsor: opt('sponsor', 'https://sponsor.moderato.tempo.xyz'),
  explorer: 'https://explore.testnet.tempo.xyz',
  program: opt('program', 'Crypto Builders Prize (demo)'),
  // where the winner completes paperwork; {ref} and {address} are filled in by the claim page
  paperworkUrl: opt('paperwork', 'paperwork?ref={ref}&address={address}'),
  escrows,
}, null, 2))
writeFileSync(`${OUT}/index.html`, '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=account.html"><title>Claimdesk</title>')
console.log(`built ${OUT}/ (claim.html, account.html, config.json)`)
