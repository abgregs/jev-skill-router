// Jev key discovery, shared by every surface that talks to Jev: runRoute (routing) and
// the PreToolUse gate (its one-skill re-judge). Kept apart from runRoute so the gate's
// bundle does not carry the skill loader.
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Find TYPESAFE_API_KEY when the environment lacks it. First the plugin's
 * `typesafe_api_key` option, which Claude Code keeps in the OS credential store and
 * exports to the plugin's hooks as CLAUDE_PLUGIN_OPTION_TYPESAFE_API_KEY. Then a
 * .env.local; candidates cover every place this module runs from: the caller's cwd (a
 * project's own .env.local), and the package root relative to this file — which is two
 * levels up in the source tree (lib/router/) and for the bundled artifacts one or two
 * levels up from dist/ and dist/hooks/.
 */
export function loadJevKey(): void {
  if (process.env.TYPESAFE_API_KEY) return
  const pluginKey = process.env.CLAUDE_PLUGIN_OPTION_TYPESAFE_API_KEY
  if (pluginKey) {
    process.env.TYPESAFE_API_KEY = pluginKey
    return
  }
  const moduleDir = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    resolve('.env.local'),
    join(moduleDir, '..', '..', '.env.local'),
    join(moduleDir, '..', '.env.local')
  ]
  for (const p of candidates) {
    if (!existsSync(p)) continue
    process.loadEnvFile(p)
    if (process.env.TYPESAFE_API_KEY) return
  }
}

/** True when a Jev key can be found (environment, plugin option, or a .env.local). */
export function jevKeyAvailable(): boolean {
  loadJevKey()
  return Boolean(process.env.TYPESAFE_API_KEY)
}
