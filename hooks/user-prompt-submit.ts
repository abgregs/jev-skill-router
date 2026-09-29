// Claude Code UserPromptSubmit hook — the routing seat.
//
// Fires before the model sees the turn. Routes the prompt plus recent transcript
// in-process (runRoute — no subprocess hop), persists the verdict to a session-keyed
// state file (read by the PreToolUse gate), and prints the approved-skill list to
// stdout — which Claude Code injects into the turn's context. The decision is made
// BEFORE the agent starts thinking, so it never faces an open "which skills?"
// question to compete on.
//
// Failure policy: this hook must never break a turn. Any error → exit 0, no output.
// There is no internal routing timeout; Claude Code's own hook timeout is the bound,
// and a killed hook writes no verdict → the gate fails open.
//
// Wiring: `jev-skill-router install claude`, or the plugin's hooks/hooks.json —
// both point at the bundled dist/hooks/user-prompt-submit.mjs.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { runRoute } from '../lib/router/runRoute.js'

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

// Estimate process start time from Node's uptime (wall-clock at module load, before any I/O).
const processStartMs = Date.now() - process.uptime() * 1000

try {
  const input = JSON.parse(readFileSync(0, 'utf8'))
  const prompt: string = (input.prompt ?? '').trim()
  const sessionId: string = input.session_id ?? 'unknown'
  const projectCwd: string = input.cwd ?? process.cwd()
  if (!prompt) process.exit(0)

  // Respect the project's own .skillrouter.json (the hook's cwd is not guaranteed).
  const projectConfig = join(projectCwd, '.skillrouter.json')

  const routeStart = Date.now()
  const verdict = await runRoute({
    query: prompt,
    // This adapter's host is Claude Code, so route on the catalog Claude Code actually
    // loads — NOT runRoute's provider-neutral ~/.agents/skills default. The two stores
    // drift; a verdict drawn from the wrong one can never name (and the gate would then
    // deny) skills the host really has. skillsDir REPLACES the root, so no dup risk.
    skillsDir: join(homedir(), '.claude', 'skills'),
    transcript: recentTranscript(input.transcript_path) || undefined,
    configPath: existsSync(projectConfig) ? projectConfig : undefined
  })
  // Field name kept from the subprocess era — session-bench reads it as "router run cost".
  const routerCliMs = Date.now() - routeStart

  // An explicit slash invocation is a command, not a data point: any catalog skill
  // the user typed as /<id> is promoted into the invoke band with certainty, past
  // the judge's score and the maxSelected cap, so instruction matches enforcement
  // (the gate already always allows prompt-named skills).
  const promptLower = prompt.toLowerCase()
  const slashNamed = Object.keys(verdict.probabilities).filter((id) => {
    const at = promptLower.indexOf(`/${id.toLowerCase()}`)
    if (at === -1) return false
    const next = promptLower[at + id.length + 1]
    return next === undefined || !/[a-z0-9-]/.test(next)
  })
  for (const id of slashNamed) {
    if (!verdict.invoke.includes(id)) verdict.invoke.push(id)
  }
  if (slashNamed.length > 0) verdict.suggest = verdict.suggest.filter((id) => !verdict.invoke.includes(id))

  mkdirSync(STATE_DIR, { recursive: true })
  const hookWallMs = Date.now() - processStartMs
  writeFileSync(
    join(STATE_DIR, `turn-${sessionId}.json`),
    JSON.stringify({
      invoke: verdict.invoke,
      suggest: verdict.suggest,
      prompt,
      ts: Date.now(),
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
  // Router unavailable or errored — stay silent, never break the user's turn.
}
process.exit(0)
