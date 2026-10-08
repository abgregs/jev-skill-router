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
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expandHome, loadConfigFile } from '../lib/config.js'
import { RouterSetupError, runRoute } from '../lib/router/runRoute.js'
import { defaultSkillRoots, SYNCED_NAMESPACE } from '../lib/skills/loadSkills.js'
import { typedSlash } from '../lib/slash.js'

export const STATE_DIR = join(tmpdir(), 'jev-skill-router')

/**
 * Conversation tail for the judge, oldest first, as "User: …" / "Assistant: …" lines.
 * Selected by role, not counted back from the end of the file: the last assistant
 * message is kept whole, because that is where a plan lives before the user says
 * "go"; every other turn is clipped to its opening characters; turns are added newest
 * first until the budget is spent. Only text blocks count — tool calls, tool results
 * and the transcript's bookkeeping entries carry no routing signal. The budget sits far
 * under Jev's state limit; it is bounded for accuracy (unrelated material costs it),
 * not for size.
 */
function recentTranscript(
  transcriptPath: string | undefined,
  prompt: string,
  budget = 8000,
  clip = 600
): string {
  if (!transcriptPath || !existsSync(transcriptPath)) return ''
  try {
    const turns = textTurns(transcriptPath)
    // Claude Code may append the prompt to the transcript before firing the hook; it
    // is sent as currentRequest already.
    if (turns.at(-1)?.role === 'User' && turns.at(-1)?.text === prompt) turns.pop()
    let lastAssistant = -1
    for (let i = turns.length - 1; i >= 0 && lastAssistant < 0; i--) if (turns[i]?.role === 'Assistant') lastAssistant = i
    const kept: string[] = []
    let left = budget
    for (let i = turns.length - 1; i >= 0 && left > 0; i--) {
      const turn = turns[i]
      if (!turn) continue
      const text = turn.text.slice(0, i === lastAssistant ? left : Math.min(clip, left))
      kept.push(`${turn.role}: ${text}`)
      left -= text.length
    }
    return kept.reverse().join('\n')
  } catch {
    return ''
  }
}

/** Every user and assistant text turn in the tail of the transcript file, oldest first. */
function textTurns(transcriptPath: string, maxBytes = 1 << 20): { role: 'User' | 'Assistant'; text: string }[] {
  const size = statSync(transcriptPath).size
  const fd = openSync(transcriptPath, 'r')
  const buf = Buffer.alloc(Math.min(size, maxBytes))
  try {
    readSync(fd, buf, 0, buf.length, size - buf.length)
  } finally {
    closeSync(fd)
  }
  const lines = buf.toString('utf8').split('\n')
  if (size > maxBytes) lines.shift() // a line cut by the byte window
  const turns: { role: 'User' | 'Assistant'; text: string }[] = []
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
      if (text.trim()) turns.push({ role: entry.type === 'user' ? 'User' : 'Assistant', text: text.trim() })
    } catch {
      // skip unparseable lines
    }
  }
  return turns
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
        'jev-skill-router@abgregs, or export TYPESAFE_API_KEY before starting Claude Code.'
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
  // The gate's record of skills loaded this turn starts empty with each new verdict.
  rmSync(join(STATE_DIR, `loaded-${sessionId}`), { recursive: true, force: true })
  if (!prompt) process.exit(0)

  // Respect the project's own .skillrouter.json (the hook's cwd is not guaranteed).
  const projectConfig = join(projectCwd, '.skillrouter.json')
  const configPath = existsSync(projectConfig) ? projectConfig : undefined

  const transcript = recentTranscript(input.transcript_path, prompt) || undefined
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
      transcript,
      configPath
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
      // The same background the verdict was judged on: the gate re-judges against it.
      transcript,
      ts: Date.now(),
      // Every skill the router judged, plus the ones the config excludes: the gate
      // governs these (excluded skills are ruled out, so it denies them) and lets the
      // rest pass.
      catalog,
      excluded: verdict.excluded,
      // SKILL.md path per judged skill: the gate reads a loaded skill's file to allow
      // the skills it names (an orchestrator calling its leaves).
      sources: Object.fromEntries(verdict.result.scored.map((s) => [s.skill.id, s.skill.source])),
      // Name and description per judged skill: what the gate's re-judge asks Jev about.
      skills: Object.fromEntries(
        verdict.result.scored.map((s) => [s.skill.id, { name: s.skill.name, description: s.skill.description }])
      ),
      // Observability extras (the gate ignores them): what the router run cost.
      judge: verdict.judge,
      judgedCount: verdict.result.judgedCount,
      latencyMs: verdict.result.latencyMs,
      // Wall-time fields for external hook cost measurement (see session-bench.ts Fix C).
      hookWallMs,
      routerCliMs
    })
  )

  // Opt-in score log (`log` in .skillrouter.json: true for the state dir, or a directory):
  // one line per routed turn carrying every judged skill's probability, so a session can
  // be read back skill by skill. Off by default because it keeps prompt text on disk.
  try {
    const logSetting = loadConfigFile(configPath).log
    const logDir = logSetting === true ? STATE_DIR : typeof logSetting === 'string' ? expandHome(logSetting) : null
    if (logDir) {
      mkdirSync(logDir, { recursive: true })
      appendFileSync(
        join(logDir, `route-${sessionId}.jsonl`),
        JSON.stringify({
          ts: Date.now(),
          session: sessionId,
          prompt,
          probabilities: verdict.probabilities,
          invoke: verdict.invoke,
          suggest: verdict.suggest,
          judgedCount: verdict.result.judgedCount,
          latencyMs: verdict.result.latencyMs
        }) + '\n'
      )
    }
  } catch {
    // the log is observability only
  }

  // Only stdout on a real verdict — conversational turns get no context noise.
  // JSON output splits the two audiences: additionalContext reaches the model,
  // systemMessage is the user-visible signature that the router ran this turn.
  if (verdict.invoke.length > 0 || verdict.suggest.length > 0) {
    const lines = [
      'Skill routing verdict for this turn (decided by the skill router — start from these rather than choosing ' +
        'skills yourself; if the work turns out to need another skill, or a skill you loaded tells you to use one, ' +
        'call it and the gate will check it):'
    ]
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
