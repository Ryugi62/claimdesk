import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tempoModerato } from 'viem/chains'
import type { Hex } from '../application/ports'

export const ENV_FILE = '.env.local'
export const CHAIN = tempoModerato
export const PATH_USD = '0x20c0000000000000000000000000000000000000' as Hex
export const EXPLORER = 'https://explore.testnet.tempo.xyz'

export function readEnv(): Record<string, string> {
  if (!existsSync(ENV_FILE)) return {}
  return Object.fromEntries(readFileSync(ENV_FILE, 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]))
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
