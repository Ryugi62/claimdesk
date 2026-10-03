import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tempoModerato } from 'viem/chains'
import type { Hex } from '../application/ports'

export const ENV_FILE = '.env.local'
export const CHAIN = tempoModerato
export const PATH_USD = '0x20c0000000000000000000000000000000000000' as Hex
export const EXPLORER = 'https://explore.testnet.tempo.xyz'

export function readEnv(file = ENV_FILE): Record<string, string> {
  if (!existsSync(file)) return {}
  return Object.fromEntries(readFileSync(file, 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
}

/** The winner-facing relay reads ONLY this file: fee-payer key, escrow, deploy block, program name. Never the organizer key. */
export const RELAY_ENV_FILE = '.env.relay'
export function writeRelayEnv() {
  const env = readEnv()
  const keep = ['FEE_PAYER_KEY_TESTNET', 'ESCROW', 'ESCROW_BLOCK', 'PROGRAM_NAME']
  writeFileSync(RELAY_ENV_FILE, keep.filter((k) => env[k]).map((k) => `${k}=${env[k]}`).join('\n') + '\n', { mode: 0o600 })
}
export function requireRelayEnv(key: string): string {
  const v = readEnv(RELAY_ENV_FILE)[key]
  if (!v) throw new Error(`${key} missing in ${RELAY_ENV_FILE} — run \`npm run cli -- relay-env\``)
  if (key.startsWith('ORGANIZER')) throw new Error('the relay never reads the organizer key')
  return v
}

export function setEnv(key: string, value: string) {
  const env = readEnv()
  env[key] = value
  writeFileSync(ENV_FILE, Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n')
}

export function requireEnv(key: string): string {
  const v = readEnv()[key] ?? process.env[key]
  if (!v) throw new Error(`${key} is not set — run \`npm run cli -- deploy\` first`)
  return v
}
