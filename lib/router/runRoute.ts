// The shared routing entry every distribution surface calls: route-cli formats its
// output for humans or --json, the Claude Code UserPromptSubmit hook consumes it
// in-process (no subprocess hop). Owns the full resolution ladder
// (explicit option > environment > config file > built-in default), skill loading,
// judge construction (including jev key discovery), and route().
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expandHome, loadConfigFile, stringList } from '../config.js'
import { loadSkills, type SkillRoot } from '../skills/loadSkills.js'
import { route } from './route.js'
import { createMockJudge } from './mockJudge.js'
import type { JevJudge } from './judge.js'
import type { RouteResult, SessionState } from '../skills/types.js'

export interface RunRouteInput {
  query: string
  transcript?: string
  /** Explicit config file path; otherwise .skillrouter.json in cwd, else home. */
  configPath?: string
  skillsDir?: string
  /** Layered roots (e.g. a host's personal + project stores); replaces skillsDir. */
  skillRoots?: SkillRoot[]
  judge?: string
  threshold?: number
  suggestFloor?: number
  maxSelected?: number
  shardSize?: number
  exclude?: string[]
}

export interface RunRouteOutput {
  result: RouteResult
  skillsDir: string
  catalogSize: number
  judge: string
  invoke: string[]
  suggest: string[]
  probabilities: Record<string, number>
  /** Installed skills the config's exclude list kept out of routing. */
  excluded: string[]
}

/**
 * A run that cannot start because of setup, not a transient failure: the hook reports
 * these once per session rather than every turn.
 */
export class RouterSetupError extends Error {
  constructor(
    readonly code: 'no-key' | 'no-skills',
    message: string
  ) {
    super(message)
  }
}

/**
 * Find TYPESAFE_API_KEY when the environment lacks it. First the plugin's
 * `typesafe_api_key` option, which Claude Code keeps in the OS credential store and
 * exports to the plugin's hooks as CLAUDE_PLUGIN_OPTION_TYPESAFE_API_KEY. Then a
 * .env.local; candidates cover every place this module runs from: the caller's cwd (a
 * project's own .env.local), and the package root relative to this file — which is two
 * levels up in the source tree (lib/router/) and for the bundled artifacts one or two
 * levels up from dist/ and dist/hooks/.
 */
function loadJevKey(): void {
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

/** Build the named judge, loading the jev key if needed. Throws with a user-facing message. */
export async function createJudgeByName(name: string): Promise<JevJudge> {
  if (name === 'jev') {
    loadJevKey()
    if (!process.env.TYPESAFE_API_KEY) {
      throw new RouterSetupError(
        'no-key',
        'The Jev judge needs TYPESAFE_API_KEY: export it, or put it in .env.local next to ' +
          "the router's package.json. For a free keyword-only dry run, pass --judge mock."
      )
    }
    // Lazy import keeps '@typesafe-ai/sdk' out of the mock pipeline's import graph.
    const { createJevJudge } = await import('./jevJudge.js')
    return createJevJudge()
  }
  if (name === 'mock') return createMockJudge()
  throw new Error(`Unknown judge "${name}". Use mock or jev.`)
}

export async function runRoute(input: RunRouteInput): Promise<RunRouteOutput> {
  const cfg = loadConfigFile(input.configPath)
  const cfgNum = (key: string) => (typeof cfg[key] === 'number' ? (cfg[key] as number) : undefined)

  const roots: SkillRoot[] = input.skillRoots ?? [
    {
      dir: expandHome(
        input.skillsDir ??
          process.env.SKILLS_DIR ??
          (typeof cfg.skillsDir === 'string' ? cfg.skillsDir : '~/.agents/skills')
      ),
      scope: 'global'
    }
  ]
  const skillsDir = roots.map((r) => r.dir).join(', ')
  // The config's exclude list removes skills from routing entirely — the user's way
  // of resolving catalog collisions (see doctor-cli) without uninstalling anything.
  const exclude = new Set(input.exclude ?? stringList(cfg.exclude))
  const installed = loadSkills(roots)
  const skills = installed.filter((s) => !exclude.has(s.id))
  if (skills.length === 0) {
    throw new RouterSetupError(
      'no-skills',
      `No skills found in ${skillsDir}. Point --skills-dir at a folder of <slug>/SKILL.md skills.`
    )
  }

  const session: SessionState = {
    latestQuery: input.query,
    transcript: input.transcript ?? ''
  }

  // Jev by default: the mock is keyword overlap, fit only for testing the plumbing, so
  // it runs only when asked for by name.
  const judgeName = input.judge ?? (cfg.judge === 'jev' || cfg.judge === 'mock' ? cfg.judge : 'jev')
  const judge = await createJudgeByName(judgeName)

  const result = await route(session, skills, judge, {
    threshold: input.threshold ?? cfgNum('threshold'),
    suggestFloor: input.suggestFloor ?? cfgNum('suggestFloor'),
    maxSelected: input.maxSelected ?? cfgNum('maxSelected'),
    shardSize: input.shardSize ?? cfgNum('shardSize')
  })

  const probabilities: Record<string, number> = {}
  for (const s of result.scored) if (s.judged && s.probability !== null) probabilities[s.skill.id] = s.probability

  return {
    result,
    skillsDir,
    excluded: installed.filter((s) => exclude.has(s.id)).map((s) => s.id),
    catalogSize: skills.length,
    judge: judge.name,
    invoke: result.selected.map((s) => s.id),
    suggest: result.suggested.map((s) => s.id),
    probabilities
  }
}
