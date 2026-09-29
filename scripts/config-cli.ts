// `jev-skill-router config` — edit the router's exclude and alwaysAllow lists without
// hand-editing .skillrouter.json.
//
//   jev-skill-router config exclude add anthropic-skills:docs     # ~/.skillrouter.json
//   jev-skill-router config allow add anthropic-skills:pdf --project  # ./.skillrouter.json
//   jev-skill-router config exclude remove brief debrief
//   jev-skill-router config show                                  # the file in effect here
//
// `add` checks every id against the catalog the router actually judges, so a short
// name like "docs" is caught ("did you mean anthropic-skills:docs?") instead of
// becoming an entry that silently matches nothing. `remove` takes any id, so stale
// entries for uninstalled skills can always be cleaned up. A file that isn't valid
// JSON is never overwritten.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { expandHome, stringList } from '../lib/config.js'
import { routableSkillIds, SYNCED_NAMESPACE } from '../lib/skills/loadSkills.js'

const USAGE =
  'Usage: jev-skill-router config <exclude|allow> <add|remove> <skill-id...> [--project]\n' +
  '       jev-skill-router config show'

const LISTS = { exclude: 'exclude', allow: 'alwaysAllow' } as const

const homeFile = join(homedir(), '.skillrouter.json')
const projectFile = resolve('.skillrouter.json')

/** Read a config file; a missing file is empty, an unparseable one is fatal. */
function readConfig(path: string): Record<string, unknown> {
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  } catch {
    console.error(`${path} is not valid JSON — fix it first; nothing was written.`)
    process.exit(1)
  }
}

/** Ids the router can judge from here: the hook's layers plus the route CLI's directory. */
function routableIds(cfg: Record<string, unknown>): Set<string> {
  return routableSkillIds(
    expandHome(process.env.SKILLS_DIR ?? (typeof cfg.skillsDir === 'string' ? cfg.skillsDir : '~/.agents/skills'))
  )
}

function show(): void {
  const inEffect = existsSync(projectFile) ? projectFile : existsSync(homeFile) ? homeFile : null
  if (!inEffect) {
    console.log(`No .skillrouter.json here or at ${homeFile} — routing uses the defaults.`)
    return
  }
  const cfg = readConfig(inEffect)
  const known = routableIds(cfg)
  console.log(`In effect here: ${inEffect}`)
  if (inEffect === projectFile && existsSync(homeFile)) {
    console.log(`(${homeFile} is ignored in this project — the project file replaces it)`)
  }
  for (const key of Object.values(LISTS)) {
    const shown = stringList(cfg[key]).map((id) => (known.has(id) ? id : `${id} (not in the routed catalog — no effect)`))
    console.log(`  ${key}: ${shown.length ? shown.join(', ') : '(empty)'}`)
  }
}

export async function main(argv: string[]): Promise<void> {
  const bools = new Set(argv.filter((a) => a.startsWith('--')).map((a) => a.slice(2)))
  const [list, action, ...ids] = argv.filter((a) => !a.startsWith('--'))
  if (bools.has('help')) {
    console.log(USAGE)
    return
  }
  if (list === 'show') {
    show()
    return
  }
  if (!(list === 'exclude' || list === 'allow') || !(action === 'add' || action === 'remove') || ids.length === 0) {
    console.error(USAGE)
    process.exit(1)
  }

  const key = LISTS[list]
  const path = bools.has('project') ? projectFile : homeFile
  const created = !existsSync(path)
  const cfg = readConfig(path)
  const current = stringList(cfg[key])

  if (action === 'add') {
    const known = routableIds(cfg)
    const problems = ids
      .filter((id) => !known.has(id))
      .map((id) =>
        known.has(`${SYNCED_NAMESPACE}:${id}`)
          ? `${id}: not a routed id — did you mean ${SYNCED_NAMESPACE}:${id}?`
          : `${id}: not in the routed catalog (personal, project, or synced skills) — the router never judges it, so the entry would have no effect`
      )
    if (problems.length > 0) {
      console.error(`${problems.join('\n')}\nNothing was written.`)
      process.exit(1)
    }
  }

  const next =
    action === 'add' ? [...current, ...ids.filter((id) => !current.includes(id))] : current.filter((id) => !ids.includes(id))
  const unchanged = action === 'add' ? ids.filter((id) => current.includes(id)) : ids.filter((id) => !current.includes(id))
  cfg[key] = next
  writeFileSync(path, JSON.stringify(cfg, null, 2) + '\n')

  console.log(`${key} in ${path}: ${next.length ? next.join(', ') : '(empty)'}`)
  if (unchanged.length > 0) {
    console.log(`(${action === 'add' ? 'already present' : 'not present'}: ${unchanged.join(', ')})`)
  }
  if (path === homeFile && existsSync(projectFile)) {
    console.log(`Note: ${projectFile} exists here and replaces ${homeFile} in this project, so this change doesn't apply here.`)
  }
  if (path === projectFile && created && existsSync(homeFile)) {
    console.log(`Note: this new project file replaces ${homeFile} in this project — copy over any settings you still want (judge, alwaysAllow, …).`)
  }
}
