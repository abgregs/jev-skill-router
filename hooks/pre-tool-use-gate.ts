// Claude Code PreToolUse gate — enforcement for the routing verdict.
//
// Matched on the Skill tool, this denies invocations of skills that are not on the
// current turn's approved list (written by hooks/user-prompt-submit.ts), turning
// "please defer to the router" into "off-list invocations do not execute".
//
// FAIL-OPEN by design: routing is a policy layer, not a security boundary. No state
// file, stale state, unparseable input → allow. Also always allowed:
//   - skills the user explicitly named in their prompt (e.g. typed "/git-commit")
//   - skills in the config's alwaysAllow list (.skillrouter.json in the project
//     cwd or the home dir) — for process skills that standing instructions require.
//
// Wiring (~/.claude/settings.json or project .claude/settings.json):
//   "hooks": { "PreToolUse": [ { "matcher": "Skill", "hooks": [ { "type": "command", "command":
//     "/ABS/jev-skill-router/node_modules/.bin/tsx /ABS/jev-skill-router/hooks/pre-tool-use-gate.ts" } ] } ] }
import { existsSync, readFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

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
  }
  if (Date.now() - state.ts > STATE_MAX_AGE_MS) allow()

  const approved = new Set([...state.invoke, ...state.suggest, ...alwaysAllowList(input.cwd ?? process.cwd())])
  // The user naming a skill in their own prompt outranks the router. Plugin skills
  // carry namespaced ids ("ns:name") while the user types the base name ("/name"),
  // so match on both — explicit invocations must always pass.
  const prompt = state.prompt.toLowerCase()
  const baseName = skill.split(':').pop() ?? skill
  if (prompt.includes(skill.toLowerCase()) || prompt.includes(baseName.toLowerCase())) allow()
  if (approved.has(skill)) allow()

  deny(
    `Skill routing gate: "${skill}" is not on this turn's approved list. ` +
      `Invoke: [${state.invoke.join(', ') || 'none'}]. Suggested: [${state.suggest.join(', ') || 'none'}]. ` +
      'Use an approved skill, or ask the user if you believe this skill is needed.'
  )
} catch {
  allow() // fail-open on any error
}
