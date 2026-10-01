// Claude Code UserPromptSubmit hook — the routing seat.
//
// Fires before the model sees the turn. Routes the prompt plus recent transcript
// in-process (runRoute — no subprocess hop), persists the verdict to a session-keyed
// state file (read by the PreToolUse gate), and prints the approved-skill list to
// stdout — which Claude Code injects into the turn's context. The decision is made
// BEFORE the agent starts thinking, so it never faces an open "which skills?"
// question to compete on.
//
// Failure policy: this hook must never break a turn. Any error → exit 0, with at most
// a one-line notice to the user (never context for the model). The last turn's verdict
// is deleted before routing, so a failed run leaves the gate nothing to enforce. There
// is no internal routing timeout; Claude Code's own hook timeout is the bound, and a
// killed hook writes no verdict → the gate fails open.
//
// Wiring: `jev-skill-router install claude`, or the plugin's hooks/hooks.json —
// both point at the bundled dist/hooks/user-prompt-submit.mjs.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RouterSetupError, runRoute } from '../lib/router/runRoute.js'
import { defaultSkillRoots, SYNCED_NAMESPACE } from '../lib/skills/loadSkills.js'
import { typedSlash } from '../lib/slash.js'

export const STATE_DIR = join(tmpdir(), 'jev-skill-router')

/** Last few conversation turns from the session transcript, oldest first. */
function recentTranscript(transcriptPath: string | undefined, maxChars = 2000): string {
  if (!transcriptPath || !existsSync(transcriptPath)) return ''
  try {
    const lines = readFileSync(transcriptPath, 'utf8').trim().split('\n').slice(-40)
    const turns: string[] = []
    for (const line of lines) {
      try {
        const entry = JSON.parse(line)
        if (entry.type !== 'user' && entry.type !== 'assistant') continue
        const content = entry.message?.content
        const text =
          typeof content === 'string'
            ? content
            : Array.isArray(content)
              ? content.filter((c: { type?: string }) => c.type === 'text').map((c: { text?: string }) => c.text).join(' ')
              : ''
        if (text.trim()) turns.push(`${entry.type === 'user' ? 'User' : 'Assistant'}: ${text.trim()}`)
      } catch {
        // skip unparseable lines
      }
    }
    return turns.join('\n').slice(-maxChars)
  } catch {
    return ''
  }
}

/** A line for the user, not the model: Claude Code shows systemMessage in the terminal. */
function notice(message: string): void {
  console.log(JSON.stringify({ systemMessage: message }))
}

/**
 * Say why this turn went unrouted. A missing key is reported once per session; an
 * empty catalog leaves nothing to route, so it stays silent; any other failure is
 * reported on the turn it happens.
 */
function reportFailure(err: unknown, sessionId: string): void {
  if (err instanceof RouterSetupError && err.code === 'no-skills') return
  if (err instanceof RouterSetupError && err.code === 'no-key') {
    const marker = join(STATE_DIR, `off-${sessionId}`)
    if (existsSync(marker)) return
    mkdirSync(STATE_DIR, { recursive: true })
    writeFileSync(marker, '')
    notice(
      'jev-skill-router is off: no TypeSafe API key. Set one with /plugin configure ' +
        'jev-skill-router@jev, or export TYPESAFE_API_KEY before starting Claude Code.'
    )
    return
  }
  const reason = (err instanceof Error ? err.message : String(err)).split('\n')[0]?.slice(0, 160)
  notice(`jev-skill-router · routing skipped this turn: ${reason}`)
}

// Estimate process start time from Node's uptime (wall-clock at module load, before any I/O).
const processStartMs = Date.now() - process.uptime() * 1000

try {
  const input = JSON.parse(readFileSync(0, 'utf8'))
  const prompt: string = (input.prompt ?? '').trim()
  const sessionId: string = input.session_id ?? 'unknown'
  const projectCwd: string = input.cwd ?? process.cwd()
  // Delete the last turn's verdict first. If this run fails or is killed, the gate then
  // finds no verdict and fails open, rather than enforcing one made for another prompt.
  const statePath = join(STATE_DIR, `turn-${sessionId}.json`)
  rmSync(statePath, { force: true })
  if (!prompt) process.exit(0)

  // Respect the project's own .skillrouter.json (the hook's cwd is not guaranteed).
  const projectConfig = join(projectCwd, '.skillrouter.json')

  const routeStart = Date.now()
  let verdict: Awaited<ReturnType<typeof runRoute>>
  try {
    verdict = await runRoute({
      query: prompt,
      // This adapter's host is Claude Code, so route on the catalog Claude Code actually
      // loads — personal ~/.claude/skills, the project's .claude/skills up to the repo
      // root, and skills synced from claude.ai — NOT runRoute's provider-neutral
      // ~/.agents/skills default. A verdict drawn from the wrong store can never name
      // skills the host really has.
      skillRoots: defaultSkillRoots(projectCwd),
      transcript: recentTranscript(input.transcript_path) || undefined,
      configPath: existsSync(projectConfig) ? projectConfig : undefined
    })
  } catch (err) {
    reportFailure(err, sessionId)
    process.exit(0)
  }
  // Field name kept from the subprocess era — session-bench reads it as "router run cost".
  const routerCliMs = Date.now() - routeStart

  // An explicit slash invocation is a command, not a data point: any catalog skill
  // the user typed as /<id> is promoted into the invoke band with certainty, past
  // the judge's score and the maxSelected cap, so instruction matches enforcement
  // (the gate always allows slash-typed skills, by the same rule). A synced skill also
  // answers to its short name (/pdf runs anthropic-skills:pdf) unless a local skill
  // holds it.
  const catalog = Object.keys(verdict.probabilities)
  const slashNamed = catalog.filter((id) => {
    const short = id.startsWith(`${SYNCED_NAMESPACE}:`) ? id.slice(SYNCED_NAMESPACE.length + 1) : null
    return typedSlash(prompt, id) || (short !== null && !catalog.includes(short) && typedSlash(prompt, short))
  })
  for (const id of slashNamed) {
    if (!verdict.invoke.includes(id)) verdict.invoke.push(id)
  }
  if (slashNamed.length > 0) verdict.suggest = verdict.suggest.filter((id) => !verdict.invoke.includes(id))

  mkdirSync(STATE_DIR, { recursive: true })
  const hookWallMs = Date.now() - processStartMs
  writeFileSync(
    statePath,
    JSON.stringify({
      invoke: verdict.invoke,
      suggest: verdict.suggest,
      prompt,
      ts: Date.now(),
      // Every skill the router judged, plus the ones the config excludes: the gate
      // governs these (excluded skills are ruled out, so it denies them) and lets the
      // rest pass.
      catalog,
      excluded: verdict.excluded,
      // Observability extras (the gate ignores them): what the router run cost.
      judge: verdict.judge,
      judgedCount: verdict.result.judgedCount,
      latencyMs: verdict.result.latencyMs,
      // Wall-time fields for external hook cost measurement (see session-bench.ts Fix C).
      hookWallMs,
      routerCliMs
    })
  )

  // Only stdout on a real verdict — conversational turns get no context noise.
  // JSON output splits the two audiences: additionalContext reaches the model,
  // systemMessage is the user-visible signature that the router ran this turn.
  if (verdict.invoke.length > 0 || verdict.suggest.length > 0) {
    const lines = ['Skill routing verdict for this turn (decided by the skill router — do not select skills yourself):']
    if (verdict.invoke.length > 0) lines.push(`- Invoke: ${verdict.invoke.join(', ')}`)
    if (verdict.suggest.length > 0)
      lines.push(`- Also relevant, invoke only if the task turns out to need them: ${verdict.suggest.join(', ')}`)
    const signature =
      `jev-skill-router · invoke [${verdict.invoke.join(', ') || '—'}]` +
      (verdict.suggest.length > 0 ? ` · suggest [${verdict.suggest.join(', ')}]` : '') +
      ` · ${verdict.result.judgedCount} judged in ${verdict.result.latencyMs}ms (${verdict.judge})`
    console.log(
      JSON.stringify({
        systemMessage: signature,
        hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: lines.join('\n') }
      })
    )
  }
} catch {
  // Unreadable hook input or an unwritable state dir — stay silent, never break the turn.
}
process.exit(0)
