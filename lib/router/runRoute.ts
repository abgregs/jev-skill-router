// The shared routing entry every distribution surface calls: route-cli formats its
// output for humans or --json, the Claude Code UserPromptSubmit hook consumes it
// in-process (no subprocess hop). Owns the full resolution ladder
// (explicit option > environment > config file > built-in default), skill loading,
// judge construction (including jev key discovery), and route().
import { expandHome, loadConfigFile, stringList } from '../config.js'
import { loadSkills, type SkillRoot } from '../skills/loadSkills.js'
import { route } from './route.js'
import { loadJevKey } from './jevKey.js'
import { createMockJudge } from './mockJudge.js'
import type { JevJudge } from './judge.js'
import type { RouteResult, SessionState } from '../skills/types.js'

export { jevKeyAvailable } from './jevKey.js'

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
