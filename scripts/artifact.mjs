// Regenerates src/adapters/claimEscrowArtifact.ts from `forge build` output.
import { readFileSync, writeFileSync } from 'node:fs'
const j = JSON.parse(readFileSync('contracts/out/ClaimEscrow.sol/ClaimEscrow.json', 'utf8'))
writeFileSync('src/adapters/claimEscrowArtifact.ts',
  '// generated from contracts/out by scripts/artifact.mjs — do not edit\n' +
  `export const claimEscrowAbi = ${JSON.stringify(j.abi)} as const\n` +
  `export const claimEscrowBytecode = '${j.bytecode.object}' as const\n`)
console.log('artifact written')
