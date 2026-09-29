// Shared CLI plumbing: config-file discovery and small helpers used identically by
// route-cli, doctor-cli, and the hooks. Errors THROW (with the user-facing message);
// each surface decides what failing means — CLIs print and exit 1, hooks stay silent.
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'

export function expandHome(p: string): string {
  return p.startsWith('~') ? resolve(homedir(), p.slice(1).replace(/^\/+/, '')) : resolve(p)
}

/** Load the config file layer: explicit path, else cwd, else home. Bad JSON fails loud. */
export function loadConfigFile(explicit?: string): Record<string, unknown> {
  const candidates = explicit
    ? [expandHome(explicit)]
    : [resolve('.skillrouter.json'), resolve(homedir(), '.skillrouter.json')]
  for (const p of candidates) {
    if (!existsSync(p)) continue
    try {
      return JSON.parse(readFileSync(p, 'utf8')) as Record<string, unknown>
    } catch {
      throw new Error(`Config ${p} is not valid JSON.`)
    }
  }
  if (explicit) throw new Error(`Config not found: ${explicit}`)
  return {}
}

export const stringList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
