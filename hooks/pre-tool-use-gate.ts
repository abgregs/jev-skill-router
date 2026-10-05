// Claude Code PreToolUse gate — enforcement for the routing verdict.
//
// Matched on the Skill tool, this denies invocations of skills that are not on the
// current turn's approved list (written by hooks/user-prompt-submit.ts), turning
// "please defer to the router" into "off-list invocations do not execute".
//
// The gate governs only skills the router judged this turn, plus the installed skills
// the config excludes (ruled out by the user, so denied). A skill it never saw —
// bundled, plugin, --add-dir, managed, or one without a description — passes, so
// the router never blocks what it could not weigh.
//
// FAIL-OPEN by design: routing is a policy layer, not a security boundary. No state
// file, stale state, unparseable input → allow. Also always allowed:
//   - skills the user typed as a slash command (e.g. "/git-commit"); naming or
//     describing a skill in prose does not count
//   - skills in the config's alwaysAllow list (.skillrouter.json in the project
//     cwd or the home dir) — for process skills that standing instructions require.
//   - skills named in the SKILL.md of a skill already loaded this turn, so an
//     orchestrator can call its leaves. Every skill the gate lets through is recorded
//     for the turn, so a chain of such calls works too. Excluded skills stay denied.
//
// Wiring (~/.claude/settings.json or project .claude/settings.json):
//   "hooks": { "PreToolUse": [ { "matcher": "Skill", "hooks": [ { "type": "command", "command":
//     "/ABS/jev-skill-router/node_modules/.bin/tsx /ABS/jev-skill-router/hooks/pre-tool-use-gate.ts" } ] } ] }
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { typedSlash } from '../lib/slash.js'

const STATE_DIR = join(tmpdir(), 'jev-skill-router')
const STATE_MAX_AGE_MS = 24 * 60 * 60 * 1000

function allow(): never {
  process.exit(0) // no output = default permission flow
}

function deny(reason: string): never {
  console.log(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        permissionDecision: 'deny',
        permissionDecisionReason: reason
      }
    })
  )
  process.exit(0)
}

/** One marker file per skill let through this turn; parallel gate runs never contend. */
function recordLoaded(loadedDir: string, id: string): void {
  try {
    mkdirSync(loadedDir, { recursive: true })
    writeFileSync(join(loadedDir, encodeURIComponent(id)), '')
  } catch {
    // an unrecorded load only narrows what later calls can chain from
  }
}

/** Whether a skill already loaded this turn names `names` in its SKILL.md. */
function namedByLoadedSkill(loadedDir: string, sources: Record<string, string>, names: string[]): boolean {
  if (!existsSync(loadedDir)) return false
  const n = names.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  // Only a deliberate reference counts: `name`, /name, or "name skill". A bare word
  // would let skills called break, brief or sweep ride in on ordinary prose.
  const mention = new RegExp(`\`/?(${n})\`|(^|[\\s(])/(${n})(?![\\w-])|(^|[^\\w-])(${n})\\s+skill\\b`, 'i')
  for (const file of readdirSync(loadedDir)) {
    const source = sources[decodeURIComponent(file)]
    if (!source) continue
    try {
      if (mention.test(readFileSync(source, 'utf8'))) return true
    } catch {
      // unreadable SKILL.md vouches for nothing
    }
  }
  return false
}

function alwaysAllowList(projectCwd: string): string[] {
  for (const p of [join(projectCwd, '.skillrouter.json'), join(homedir(), '.skillrouter.json')]) {
    if (!existsSync(p)) continue
    try {
      const cfg = JSON.parse(readFileSync(p, 'utf8'))
      if (Array.isArray(cfg.alwaysAllow)) return cfg.alwaysAllow.filter((x: unknown) => typeof x === 'string')
    } catch {
      // unparseable config → no list
    }
    break
  }
  return []
}

try {
  const input = JSON.parse(readFileSync(0, 'utf8'))
  if (input.tool_name !== 'Skill') allow()
  const skill: string = input.tool_input?.skill ?? ''
  if (!skill) allow()

  const statePath = join(STATE_DIR, `turn-${input.session_id ?? 'unknown'}.json`)
  if (!existsSync(statePath)) allow()
  const state = JSON.parse(readFileSync(statePath, 'utf8')) as {
    invoke: string[]
    suggest: string[]
    prompt: string
    ts: number
    catalog?: string[]
    excluded?: string[]
    sources?: Record<string, string>
  }
  if (Date.now() - state.ts > STATE_MAX_AGE_MS) allow()

  // Resolve the call to a governed id. A synced skill is known as anthropic-skills:<name>
  // but may be invoked by its short name when no local skill holds it. Anything the
  // router neither judged nor excluded passes (a state file without a catalog
  // predates this rule).
  const governed = new Set([...(state.catalog ?? []), ...(state.excluded ?? [])])
  const synced = `anthropic-skills:${skill}`
  const judgedId = governed.has(skill) ? skill : governed.has(synced) ? synced : null
  if (!judgedId) allow()

  const approved = new Set([...state.invoke, ...state.suggest, ...alwaysAllowList(input.cwd ?? process.cwd())])
  // The user slash-invoking a skill outranks the router. Plugin and synced skills
  // carry namespaced ids ("ns:name") while the user may type the base name ("/name"),
  // so match on both — explicit invocations must always pass.
  const baseName = skill.split(':').pop() ?? skill
  const loadedDir = join(STATE_DIR, `loaded-${input.session_id ?? 'unknown'}`)
  if (
    typedSlash(state.prompt, skill) ||
    typedSlash(state.prompt, baseName) ||
    approved.has(skill) ||
    approved.has(judgedId) ||
    (!(state.excluded ?? []).includes(judgedId) &&
      namedByLoadedSkill(loadedDir, state.sources ?? {}, [...new Set([skill, judgedId])]))
  ) {
    recordLoaded(loadedDir, judgedId)
    allow()
  }

  deny(
    `Skill routing gate: "${skill}" is not on this turn's approved list. ` +
      `Invoke: [${state.invoke.join(', ') || 'none'}]. Suggested: [${state.suggest.join(', ') || 'none'}]. ` +
      'Use an approved skill, or ask the user if you believe this skill is needed.'
  )
} catch {
  allow() // fail-open on any error
}
