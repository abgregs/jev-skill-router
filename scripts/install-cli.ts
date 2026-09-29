// `jev-skill-router install claude` — register the bundled hooks in Claude Code
// settings, so the router runs every turn without hand-editing settings.json.
//
//   jev-skill-router install claude               # ~/.claude/settings.json
//   jev-skill-router install claude --project     # ./.claude/settings.json
//   jev-skill-router install claude --dry-run     # print the result, write nothing
//   jev-skill-router install claude --uninstall   # remove the router's hook entries
//
// Idempotent by construction: every hook entry whose command mentions this router
// (by hook filename or package name) is removed first, then fresh entries pointing
// at THIS install's bundles are appended. That specifically cures the observed
// manual-install failure mode: a stale absolute path from a previous clone/copy
// staying registered forever. Prefer the plugin install where available; this is
// the door for plain settings.json setups and other-host adapters to copy.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

interface HookEntry {
  matcher?: string
  hooks?: { type?: string; command?: string }[]
}

const USAGE = 'Usage: jev-skill-router install claude [--project] [--dry-run] [--uninstall]'

/** Marks a settings hook entry as ours, across renames, clones, and old manual installs. */
function isOurs(entry: HookEntry): boolean {
  return (entry.hooks ?? []).some(
    (h) =>
      typeof h.command === 'string' &&
      /user-prompt-submit|pre-tool-use-gate|jev-skill-router/.test(h.command)
  )
}

/** The bundled hooks, relative to this module: dist/cli.mjs in a bundle, scripts/ in dev. */
function hookBundles(): { prompt: string; gate: string } {
  const moduleDir = dirname(fileURLToPath(import.meta.url))
  for (const dir of [join(moduleDir, 'hooks'), join(moduleDir, '..', 'dist', 'hooks')]) {
    const prompt = join(dir, 'user-prompt-submit.mjs')
    const gate = join(dir, 'pre-tool-use-gate.mjs')
    if (existsSync(prompt) && existsSync(gate)) return { prompt, gate }
  }
  throw new Error('Bundled hooks not found — run "npm run build" first (they live in dist/hooks/).')
}

export async function main(argv: string[]): Promise<void> {
  const bools = new Set(argv.filter((a) => a.startsWith('--')).map((a) => a.slice(2)))
  const host = argv.find((a) => !a.startsWith('--'))
  if (bools.has('help')) {
    console.log(USAGE)
    return
  }
  if (host !== 'claude') {
    console.error(`${USAGE}\n("claude" is the only supported host today.)`)
    process.exit(1)
  }

  const settingsPath = bools.has('project')
    ? resolve('.claude', 'settings.json')
    : join(homedir(), '.claude', 'settings.json')

  let settings: Record<string, unknown> = {}
  if (existsSync(settingsPath)) {
    try {
      settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as Record<string, unknown>
    } catch {
      // Never clobber a file we can't parse — that's the user's live settings.
      console.error(`${settingsPath} is not valid JSON — fix it first; nothing was written.`)
      process.exit(1)
    }
  }

  const hooks = (settings.hooks ?? {}) as Record<string, HookEntry[]>
  const kept = {
    UserPromptSubmit: (hooks.UserPromptSubmit ?? []).filter((e) => !isOurs(e)),
    PreToolUse: (hooks.PreToolUse ?? []).filter((e) => !isOurs(e))
  }
  const removedCount =
    (hooks.UserPromptSubmit?.length ?? 0) - kept.UserPromptSubmit.length +
    ((hooks.PreToolUse?.length ?? 0) - kept.PreToolUse.length)

  if (!bools.has('uninstall')) {
    const { prompt, gate } = hookBundles()
    kept.UserPromptSubmit.push({ hooks: [{ type: 'command', command: `node "${prompt}"` }] })
    kept.PreToolUse.push({ matcher: 'Skill', hooks: [{ type: 'command', command: `node "${gate}"` }] })
  }

  for (const [event, entries] of Object.entries(kept)) {
    if (entries.length > 0) hooks[event] = entries
    else delete hooks[event]
  }
  if (Object.keys(hooks).length > 0) settings.hooks = hooks
  else delete settings.hooks

  const serialized = JSON.stringify(settings, null, 2) + '\n'
  if (bools.has('dry-run')) {
    console.error(`Dry run — would write ${settingsPath}` + (removedCount ? ` (replacing ${removedCount} existing router entr${removedCount === 1 ? 'y' : 'ies'})` : '') + ':')
    console.log(serialized)
    return
  }

  mkdirSync(dirname(settingsPath), { recursive: true })
  writeFileSync(settingsPath, serialized)
  if (bools.has('uninstall')) {
    console.log(`Removed ${removedCount} router hook entr${removedCount === 1 ? 'y' : 'ies'} from ${settingsPath}.`)
  } else {
    console.log(
      `Registered the router's hooks in ${settingsPath}` +
        (removedCount ? ` (replaced ${removedCount} stale entr${removedCount === 1 ? 'y' : 'ies'})` : '') +
        '.\nTakes effect in new Claude Code sessions.'
    )
  }
}
