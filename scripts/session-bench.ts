// A/B benchmark: does the router hook get a REAL Claude Code session to the right
// skills, and at what cost, compared with stock skill selection?
//
// Two scratch workspaces, identical except .claude/settings.json: one wires the
// released router bundles (dist/hooks, exactly what the plugin ships), the other
// wires nothing. Both arms run with --setting-sources project so the user's global
// hook wiring cannot contaminate the no-router arm. Each arm is ONE headless
// `claude -p` process in streaming-input mode that carries every fixture prompt as a
// sequential user turn (the multi-turn session a real user has), or one fixture per
// process with --per-fixture. Both arms of a rep launch simultaneously (paired design,
// same network weather) and the stream-json output is parsed live.
//
// Stop rule is SYMMETRIC: every turn runs to natural completion in both arms. The
// only kills are a per-turn step cap and a per-turn timeout, applied identically, so
// cost, duration and token totals are comparable across arms (the earlier
// expected-satisfied early kill made them incomparable — see bench/results/README.md).
//
// Per turn we record: skill invocations vs curated truth (hits / acceptable / junk),
// gate denials, SKILL.md bytes pulled into context, time to first Skill call, the
// turn's own usage from its `result` event, and — router arm only — the hook's
// verdict and timing from its state file (the hook's cost is reported, not hidden).
// Per session: the cumulative cost from the last `result`, and any gate re-judges.
//
//   npm run bench:session -- --dry-run
//   npm run bench:session -- --reps 3 --model opus
//   npm run bench:session -- --per-fixture --fixtures build-animation --reps 1 --model haiku
//
// Cost is REAL on both meters: each router-arm turn spends one Noul per routed skill
// (plus one per gate re-judge), and every turn is a real Claude session turn run to
// completion.
import { execFileSync, spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BENCH_FIXTURES, type BenchFixture } from '../fixtures/bench-sessions.js'
import { loadSkills } from '../lib/skills/loadSkills.js'

const ROUTER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const STATE_DIR = join(tmpdir(), 'jev-skill-router')

// Both arms route on the same catalog definition as the recorded runs
// (docs/evaluation/results.md): shipped policy, with the two user-workflow skills
// excluded. A project .skillrouter.json replaces ~/.skillrouter.json entirely for
// both the router and the gate, so the user's personal config cannot leak in.
const ARM_CONFIG = { exclude: ['brief', 'debrief'] }

// Capture repo git SHA at run start for provenance (best-effort; null if not a git repo).
function gitSha(): string | null {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROUTER_DIR, encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

type Arm = 'router' | 'no-router'

interface SkillCall {
  skill: string
  toolUseId: string
  /** ms from the turn's start to the assistant message carrying this tool_use. */
  atMs: number
  denied: boolean
  deniedReason?: string
  resolved: boolean
  /** Size of the skill's SKILL.md on disk; null when the id is not in the catalog. */
  skillMdBytes: number | null
}

interface Usage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
}

interface TurnRecord {
  fixture: string
  turnIndex: number
  endedBy: 'completed' | 'step-cap' | 'timeout' | 'not-run'
  /** ms from session spawn to the turn's user message being sent. */
  startedAtMs: number
  durationMs: number
  firstSkillMs: number | null
  skillCalls: SkillCall[]
  hits: string[]
  missed: string[]
  acceptableInvoked: string[]
  junkInvoked: string[]
  deniedCount: number
  /** SKILL.md bytes of every distinct skill loaded (non-denied) this turn. */
  skillMdBytesLoaded: number
  assistantMessages: number
  /** The turn's own usage as reported by its `result` event (per-turn in streaming mode). */
  usage: Usage | null
  /** Cross-check: the same four counters summed over the turn's assistant messages. */
  usageFromMessages: Usage | null
  /** Cumulative session cost as of this turn's `result` (estimate, per Claude Code). */
  costUsdCumulative: number | null
  resultDurationMs: number | null
  /** Router arm only: the hook's persisted verdict for this turn (includes latencyMs etc.). */
  hookVerdict: Record<string, unknown> | null
  hookWallMs: number | null
  routerCliMs: number | null
  /** No-router arm: true if a hook state file appeared anyway — arm contamination. */
  contaminated: boolean
}

interface SessionRecord {
  arm: Arm
  rep: number
  sessionId: string | null
  model: string | null
  endedBy: 'completed' | 'step-cap' | 'timeout' | 'spawn-error'
  durationMs: number
  spawnToInitMs: number | null
  turns: TurnRecord[]
  totalCostUsd: number | null
  skillMdBytesLoaded: number
  /** Router arm: gate re-judge log entries ({ts, skill, p, allowed}). */
  gateRejudges: unknown[]
  stderrTail: string
}

// ---------------------------------------------------------------------------
// args

function parseArgs(argv: string[]): { opts: Record<string, string>; bools: Set<string> } {
  const opts: Record<string, string> = {}
  const bools = new Set<string>()
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string
    if (!a.startsWith('--')) continue
    const key = a.slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) bools.add(key)
    else {
      opts[key] = next
      i++
    }
  }
  return { opts, bools }
}

const { opts, bools } = parseArgs(process.argv.slice(2))
const model = opts.model ?? 'sonnet'
const reps = opts.reps ? Number(opts.reps) : 3
/** Assistant messages allowed per user turn before the session is killed (symmetric safety cap). */
const maxSteps = opts['max-steps'] ? Number(opts['max-steps']) : 40
/** Wall-clock allowed per user turn (symmetric safety cap). */
const turnTimeoutMs = (opts['timeout-sec'] ? Number(opts['timeout-sec']) : 600) * 1000
const claudeBin = opts['claude-bin'] ?? 'claude'
const workRoot = opts['work-root'] ?? join(tmpdir(), 'jev-session-bench')
const outDir = resolve(ROUTER_DIR, opts.out ?? 'bench/session-results')
const perFixture = bools.has('per-fixture')
const allowedTools = ['Skill', 'Read', 'Glob', 'Grep', 'Write', 'Edit', 'TodoWrite', 'Bash(git:*)']

const fixtureFilter = opts.fixtures?.split(',').map((x) => x.trim())
const fixtures = fixtureFilter
  ? BENCH_FIXTURES.filter((f) => fixtureFilter.includes(f.id))
  : BENCH_FIXTURES
if (fixtures.length === 0) {
  console.error(`No matching fixtures. Available: ${BENCH_FIXTURES.map((f) => f.id).join(', ')}`)
  process.exit(1)
}
/** Each entry is one session's prompt series, in order. */
const sessionPlans: BenchFixture[][] = perFixture ? fixtures.map((f) => [f]) : [fixtures]

// ---------------------------------------------------------------------------
// preflight — fail loud on anything that would silently bias an arm

interface PreflightResult {
  notes: string[]
  /** Human-readable degraded states (missing skills, unsized skills) to stamp into meta. */
  degraded: string[]
  installedSkillCount: number
  routableSkillCount: number
  /** skill id → SKILL.md bytes, for the bytes-loaded metric (both arms, same catalog). */
  skillMdBytes: Map<string, number>
}

function preflight(): PreflightResult {
  const notes: string[] = []
  const degraded: string[] = []

  // The router arm needs the Jev key or it silently degrades to "no verdict".
  const keyReachable =
    !!process.env.TYPESAFE_API_KEY ||
    existsSync(join(ROUTER_DIR, '.env.local')) ||
    existsSync(resolve(ROUTER_DIR, '..', '.env.local'))
  if (!keyReachable) {
    console.error(
      'TYPESAFE_API_KEY is unreachable (env, jev-skill-router/.env.local, ../.env.local). ' +
        'The router arm would silently produce no verdicts — refusing to run a dishonest benchmark.'
    )
    process.exit(1)
  }
  for (const b of ['user-prompt-submit.mjs', 'pre-tool-use-gate.mjs']) {
    if (!existsSync(join(ROUTER_DIR, 'dist', 'hooks', b))) {
      console.error(`dist/hooks/${b} is missing — run \`npm run build\`; the bench wires the released bundles.`)
      process.exit(1)
    }
  }
  notes.push(`arm config (.skillrouter.json in both arms): ${JSON.stringify(ARM_CONFIG)}`)

  // Expected ids must exist as installed Claude skills or hits are impossible.
  const claudeSkills = new Set(
    existsSync(join(homedir(), '.claude', 'skills')) ? readdirSync(join(homedir(), '.claude', 'skills')) : []
  )
  for (const f of fixtures) {
    const missing = [...f.expected, ...f.acceptable].filter((id) => !claudeSkills.has(id))
    if (missing.length > 0) {
      const msg = `${f.id}: not installed in ~/.claude/skills: ${missing.join(', ')} — those can never hit`
      console.warn(`WARNING ${msg}.`)
      degraded.push(msg)
    }
  }
  const installedSkillCount = claudeSkills.size
  notes.push(`installed ~/.claude/skills: ${installedSkillCount}`)
  // Dir count ≠ judged count: the router only judges skills loadSkills() can route on
  // (a SKILL.md with a frontmatter description) — record the number Nouls are billed for.
  const skills = loadSkills()
  const routableSkillCount = skills.length - ARM_CONFIG.exclude.filter((id) => skills.some((s) => s.id === id)).length
  notes.push(`routable skills (loadSkills minus exclude): ${routableSkillCount}`)
  const skillMdBytes = new Map<string, number>()
  for (const s of skills) {
    try {
      skillMdBytes.set(s.id, statSync(s.source).size)
    } catch {
      degraded.push(`${s.id}: SKILL.md unreadable at ${s.source} — bytes-loaded metric will skip it`)
    }
  }
  return { notes, degraded, installedSkillCount, routableSkillCount, skillMdBytes }
}

// ---------------------------------------------------------------------------
// workspaces

function armDir(arm: Arm): string {
  return join(workRoot, arm)
}

// Every fixture prompt references project state (a toast component, staged changes, a
// Swift module). An EMPTY workspace makes the model hunt for missing files instead of
// invoking skills — so both arms get the SAME tiny stub project, reset before every
// paired session so one rep's writes cannot leak into the next.
const STUB_FILES: Record<string, string> = {
  'README.md': '# demo-app\n\nSmall app used for the jev-skill-router recorded demo work.\n',
  'package.json': JSON.stringify({ name: 'demo-app', version: '0.1.0', private: true }, null, 2),
  'components/toast.tsx': [
    "import { useEffect } from 'react'",
    '',
    'export function Toast({ message, onDone }: { message: string; onDone: () => void }) {',
    '  useEffect(() => { const t = setTimeout(onDone, 4000); return () => clearTimeout(t) }, [onDone])',
    '  // appears/disappears instantly — no enter or exit animation yet',
    '  return <div className="toast">{message}</div>',
    '}',
    ''
  ].join('\n'),
  'components/ui/combobox.tsx': [
    "import { useState } from 'react'",
    '',
    'export function Combobox({ options }: { options: string[] }) {',
    '  const [open, setOpen] = useState(false)',
    '  const [value, setValue] = useState("")',
    '  return (',
    '    <div className="combobox">',
    '      <div className="trigger" onClick={() => setOpen(!open)}>{value || "Select…"}</div>',
    '      {open && options.map((o) => (',
    '        <div key={o} className="option" onClick={() => { setValue(o); setOpen(false) }}>{o}</div>',
    '      ))}',
    '    </div>',
    '  )',
    '}',
    ''
  ].join('\n'),
  'Sources/App/SyncEngine.swift': [
    'import Foundation',
    '',
    'class SyncEngine {',
    '    var pending: [String] = []',
    '    var lastSync: Date?',
    '',
    '    func enqueue(_ item: String) {',
    '        pending.append(item)',
    '    }',
    '',
    '    func syncAll(completion: @escaping () -> Void) {',
    '        DispatchQueue.global().async {',
    '            self.pending.removeAll()',
    '            self.lastSync = Date()',
    '            completion()',
    '        }',
    '    }',
    '}',
    ''
  ].join('\n'),
  'src/retry.ts': [
    'export async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {',
    '  let lastError: unknown',
    '  for (let i = 0; i < attempts; i++) {',
    '    try {',
    '      return await fn()',
    '    } catch (err) {',
    '      lastError = err',
    '    }',
    '  }',
    '  throw lastError',
    '}',
    ''
  ].join('\n')
}

// The staged-but-uncommitted change the commit-and-pr fixture talks about.
const STAGED_RETRY_PATCH = STUB_FILES['src/retry.ts']!.replace(
  '      lastError = err',
  '      lastError = err\n      await new Promise((r) => setTimeout(r, 2 ** i * 100)) // exponential backoff'
)

function git(dir: string, ...args: string[]): void {
  execFileSync('git', args, { cwd: dir, stdio: 'ignore' })
}

function resetWorkspace(arm: Arm): void {
  // The released bundles, wired exactly as hooks/hooks.json wires them for the plugin.
  const hookCmd = (bundle: string) => `node "${join(ROUTER_DIR, 'dist', 'hooks', bundle)}"`
  const settings =
    arm === 'router'
      ? {
          hooks: {
            UserPromptSubmit: [{ hooks: [{ type: 'command', command: hookCmd('user-prompt-submit.mjs') }] }],
            PreToolUse: [
              { matcher: 'Skill', hooks: [{ type: 'command', command: hookCmd('pre-tool-use-gate.mjs') }] }
            ]
          }
        }
      : {}
  const dir = armDir(arm)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(join(dir, '.claude'), { recursive: true })
  writeFileSync(join(dir, '.claude', 'settings.json'), JSON.stringify(settings, null, 2))
  writeFileSync(join(dir, '.skillrouter.json'), JSON.stringify(ARM_CONFIG, null, 2))
  // --setting-sources project drops USER-level skills, so give both arms the user's
  // catalog as PROJECT skills (symlink — identical bytes, no per-reset copy cost).
  symlinkSync(join(homedir(), '.claude', 'skills'), join(dir, '.claude', 'skills'))
  for (const [rel, content] of Object.entries(STUB_FILES)) {
    mkdirSync(dirname(join(dir, rel)), { recursive: true })
    writeFileSync(join(dir, rel), content)
  }
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'config', 'user.email', 'bench@example.com')
  git(dir, 'config', 'user.name', 'Session Bench')
  git(dir, 'add', '-A')
  git(dir, 'commit', '-q', '-m', 'chore: initial demo-app scaffold')
  writeFileSync(join(dir, 'src/retry.ts'), STAGED_RETRY_PATCH)
  git(dir, 'add', 'src/retry.ts')
}

// ---------------------------------------------------------------------------
// one headless session carrying a series of user turns

function emptyUsage(): Usage {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 }
}

function usageOf(u: any): Usage | null {
  if (!u || typeof u !== 'object') return null
  return {
    inputTokens: u.input_tokens ?? 0,
    outputTokens: u.output_tokens ?? 0,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheCreationTokens: u.cache_creation_input_tokens ?? 0
  }
}

function newTurn(fixture: BenchFixture, turnIndex: number, startedAtMs: number): TurnRecord {
  return {
    fixture: fixture.id,
    turnIndex,
    endedBy: 'not-run',
    startedAtMs,
    durationMs: 0,
    firstSkillMs: null,
    skillCalls: [],
    hits: [],
    missed: [],
    acceptableInvoked: [],
    junkInvoked: [],
    deniedCount: 0,
    skillMdBytesLoaded: 0,
    assistantMessages: 0,
    usage: null,
    usageFromMessages: null,
    costUsdCumulative: null,
    resultDurationMs: null,
    hookVerdict: null,
    hookWallMs: null,
    routerCliMs: null,
    contaminated: false
  }
}

function runSession(
  plan: BenchFixture[],
  arm: Arm,
  rep: number,
  skillMdBytes: Map<string, number>
): Promise<SessionRecord> {
  return new Promise((resolvePromise) => {
    const t0 = Date.now()
    const rec: SessionRecord = {
      arm,
      rep,
      sessionId: null,
      model: null,
      endedBy: 'completed',
      durationMs: 0,
      spawnToInitMs: null,
      turns: plan.map((f, i) => newTurn(f, i, 0)),
      totalCostUsd: null,
      skillMdBytesLoaded: 0,
      gateRejudges: [],
      stderrTail: ''
    }

    const child = spawn(
      claudeBin,
      [
        '-p',
        '--input-format',
        'stream-json',
        '--output-format',
        'stream-json',
        '--verbose',
        '--setting-sources',
        'project',
        '--strict-mcp-config',
        '--model',
        model,
        '--allowedTools',
        allowedTools.join(',')
      ],
      { cwd: armDir(arm), env: process.env, stdio: ['pipe', 'pipe', 'pipe'] }
    )

    let killed = false
    let turnIdx = -1
    let turnT0 = 0
    let turnTimer: NodeJS.Timeout | null = null
    // stream-json emits one assistant event PER CONTENT BLOCK; a real API turn is the
    // set of events sharing message.id. Count steps and tokens per id, not per event.
    let msgUsage = new Map<string, Usage>() // message.id → last-seen usage (this user turn)
    const pending = new Map<string, SkillCall>() // toolUseId → call awaiting its result

    const kill = (why: 'step-cap' | 'timeout') => {
      if (killed) return
      killed = true
      rec.endedBy = why
      const t = rec.turns[turnIdx]
      if (t) t.endedBy = why
      child.stdin.end()
      child.kill('SIGTERM')
      setTimeout(() => child.kill('SIGKILL'), 5000).unref()
    }

    const sendTurn = () => {
      turnIdx++
      const fixture = plan[turnIdx]!
      turnT0 = Date.now()
      const turn = rec.turns[turnIdx]!
      turn.startedAtMs = turnT0 - t0
      msgUsage = new Map()
      if (turnTimer) clearTimeout(turnTimer)
      turnTimer = setTimeout(() => kill('timeout'), turnTimeoutMs)
      child.stdin.write(
        JSON.stringify({
          type: 'user',
          message: { role: 'user', content: [{ type: 'text', text: fixture.prompt }] }
        }) + '\n'
      )
    }

    const closeTurn = (e: any) => {
      const turn = rec.turns[turnIdx]!
      const fixture = plan[turnIdx]!
      if (turnTimer) clearTimeout(turnTimer)
      turn.endedBy = 'completed'
      turn.durationMs = Date.now() - turnT0
      turn.usage = usageOf(e.usage)
      turn.costUsdCumulative = typeof e.total_cost_usd === 'number' ? e.total_cost_usd : null
      turn.resultDurationMs = typeof e.duration_ms === 'number' ? e.duration_ms : null
      if (msgUsage.size > 0) {
        const sum = emptyUsage()
        for (const u of msgUsage.values()) {
          sum.inputTokens += u.inputTokens
          sum.outputTokens += u.outputTokens
          sum.cacheReadTokens += u.cacheReadTokens
          sum.cacheCreationTokens += u.cacheCreationTokens
        }
        turn.usageFromMessages = sum
      }
      // Score invocations against curated truth. A denied call is not a hit.
      const invoked = new Set(turn.skillCalls.filter((c) => !c.denied).map((c) => c.skill))
      turn.hits = fixture.expected.filter((id) => invoked.has(id))
      turn.missed = fixture.expected.filter((id) => !invoked.has(id))
      turn.acceptableInvoked = [...invoked].filter((id) => fixture.acceptable.includes(id))
      turn.junkInvoked = [...invoked].filter(
        (id) => !fixture.expected.includes(id) && !fixture.acceptable.includes(id)
      )
      for (const id of invoked) turn.skillMdBytesLoaded += skillMdBytes.get(id) ?? 0
      // The hook rewrites turn-<session>.json at the start of every user turn, so at
      // this turn's result it holds this turn's verdict. Snapshot it before the next turn.
      if (rec.sessionId) {
        const statePath = join(STATE_DIR, `turn-${rec.sessionId}.json`)
        if (existsSync(statePath)) {
          try {
            const verdict = JSON.parse(readFileSync(statePath, 'utf8'))
            if (arm === 'router') {
              turn.hookVerdict = verdict
              if (typeof verdict.hookWallMs === 'number') turn.hookWallMs = verdict.hookWallMs
              if (typeof verdict.routerCliMs === 'number') turn.routerCliMs = verdict.routerCliMs
            } else turn.contaminated = true
          } catch {
            /* unreadable state — leave nulls */
          }
        }
      }
      if (turnIdx + 1 < plan.length) sendTurn()
      else child.stdin.end()
    }

    child.stderr.on('data', (d: Buffer) => {
      rec.stderrTail = (rec.stderrTail + d.toString()).slice(-2000)
    })
    child.on('error', () => {
      rec.endedBy = 'spawn-error'
      finish()
    })

    const rl = createInterface({ input: child.stdout })
    rl.on('line', (line) => {
      let e: any
      try {
        e = JSON.parse(line)
      } catch {
        return
      }
      const turn = rec.turns[turnIdx]
      const now = Date.now() - turnT0

      // Streaming-input mode emits an init event per user turn; keep the first timing.
      if (e.type === 'system' && e.subtype === 'init') {
        rec.sessionId = e.session_id ?? null
        rec.model = e.model ?? null
        if (rec.spawnToInitMs === null) rec.spawnToInitMs = Date.now() - t0
        return
      }
      if (!turn) return

      if (e.type === 'assistant' && e.message) {
        const msgId: string = e.message.id ?? `anon-${turn.assistantMessages}`
        if (!msgUsage.has(msgId)) {
          turn.assistantMessages++
          msgUsage.set(msgId, emptyUsage())
          if (turn.assistantMessages > maxSteps) {
            kill('step-cap')
            return
          }
        }
        const content: any[] = Array.isArray(e.message.content) ? e.message.content : []
        for (const block of content) {
          if (block.type === 'tool_use' && block.name === 'Skill') {
            const skill = String(block.input?.skill ?? block.input?.command ?? '')
            if (turn.firstSkillMs === null) turn.firstSkillMs = now
            const call: SkillCall = {
              skill,
              toolUseId: block.id,
              atMs: now,
              denied: false,
              resolved: false,
              skillMdBytes: skillMdBytes.get(skill) ?? null
            }
            turn.skillCalls.push(call)
            pending.set(block.id, call)
          }
        }
        const u = usageOf(e.message.usage)
        if (u) {
          const prev = msgUsage.get(msgId)!
          msgUsage.set(msgId, {
            inputTokens: Math.max(prev.inputTokens, u.inputTokens),
            outputTokens: Math.max(prev.outputTokens, u.outputTokens),
            cacheReadTokens: Math.max(prev.cacheReadTokens, u.cacheReadTokens),
            cacheCreationTokens: Math.max(prev.cacheCreationTokens, u.cacheCreationTokens)
          })
        }
        return
      }

      if (e.type === 'user' && e.message) {
        const content: any[] = Array.isArray(e.message.content) ? e.message.content : []
        for (const block of content) {
          if (block.type !== 'tool_result' || !pending.has(block.tool_use_id)) continue
          const call = pending.get(block.tool_use_id)!
          call.resolved = true
          const text =
            typeof block.content === 'string'
              ? block.content
              : Array.isArray(block.content)
                ? block.content.map((c: any) => c.text ?? '').join(' ')
                : ''
          if (block.is_error || text.includes('Skill routing gate:')) {
            call.denied = true
            call.deniedReason = text.slice(0, 200)
            turn.deniedCount++
          }
          pending.delete(block.tool_use_id)
        }
        return
      }

      // Streaming-input mode: one `result` per user turn — the turn boundary.
      if (e.type === 'result' && !killed) closeTurn(e)
    })

    const finish = () => {
      if (turnTimer) clearTimeout(turnTimer)
      rec.durationMs = Date.now() - t0
      const last = [...rec.turns].reverse().find((t) => t.costUsdCumulative !== null)
      rec.totalCostUsd = last ? last.costUsdCumulative : null
      rec.skillMdBytesLoaded = rec.turns.reduce((a, t) => a + t.skillMdBytesLoaded, 0)
      if (arm === 'router' && rec.sessionId) {
        const logPath = join(STATE_DIR, `gate-${rec.sessionId}.jsonl`)
        if (existsSync(logPath)) {
          rec.gateRejudges = readFileSync(logPath, 'utf8')
            .split('\n')
            .filter(Boolean)
            .map((l) => {
              try {
                return JSON.parse(l)
              } catch {
                return { raw: l }
              }
            })
        }
      }
      resolvePromise(rec)
    }
    child.on('close', finish)
    sendTurn()
  })
}

// ---------------------------------------------------------------------------
// aggregation

function median(xs: number[]): number | null {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2
}

function fmtMs(ms: number | null): string {
  return ms === null ? '—' : `${(ms / 1000).toFixed(1)}s`
}

function fmtDist(xs: number[], fmt: (x: number | null) => string = fmtMs): string {
  const m = median(xs)
  if (m === null) return '—'
  return `${fmt(m)} (${fmt(Math.min(...xs))}–${fmt(Math.max(...xs))})`
}

const fmtK = (n: number | null) => (n === null ? '—' : `${(n / 1000).toFixed(1)}k`)
const fmtUsd = (n: number | null) => (n === null ? '—' : `$${n.toFixed(3)}`)

function summarize(sessions: SessionRecord[]): void {
  console.log('\n================= SESSION BENCH SUMMARY =================')
  console.log(
    `model=${model} · reps=${reps} · ${perFixture ? 'one fixture per session' : `${fixtures.length}-turn sessions`}` +
      ` · symmetric stop (step-cap ${maxSteps}, turn timeout ${turnTimeoutMs / 1000}s) · paired launches\n`
  )
  const turnsOf = (arm: Arm, id: string) =>
    sessions.flatMap((s) => s.turns.filter((t) => s.arm === arm && t.fixture === id && t.endedBy === 'completed'))
  for (const f of fixtures) {
    console.log(`${f.id}${f.negativeControl ? '  [negative control — correct outcome: no skills]' : ''}`)
    console.log(`  expected: [${f.expected.join(', ') || 'none'}]`)
    for (const arm of ['no-router', 'router'] as Arm[]) {
      const ts = turnsOf(arm, f.id)
      if (ts.length === 0) {
        console.log(`  ${arm.padEnd(10)} no completed turns`)
        continue
      }
      const hitRate =
        f.expected.length === 0 ? null : ts.reduce((a, t) => a + t.hits.length, 0) / (ts.length * f.expected.length)
      const junk = ts.reduce((a, t) => a + t.junkInvoked.length, 0)
      const denied = ts.reduce((a, t) => a + t.deniedCount, 0)
      const firstSkill = ts.filter((t) => t.firstSkillMs !== null).map((t) => t.firstSkillMs!)
      const bytes = ts.map((t) => t.skillMdBytesLoaded)
      const outTok = ts.filter((t) => t.usage).map((t) => t.usage!.outputTokens)
      const inTok = ts.filter((t) => t.usage).map((t) => t.usage!.inputTokens + t.usage!.cacheReadTokens + t.usage!.cacheCreationTokens)
      const dur = ts.map((t) => t.durationMs)
      const hookWall = ts.filter((t) => t.hookWallMs !== null).map((t) => t.hookWallMs!)
      const cols = [
        `n=${ts.length}`,
        hitRate === null ? null : `hits ${(hitRate * 100).toFixed(0)}%`,
        `junk ${junk}`,
        denied > 0 ? `gate-denied ${denied}` : null,
        `first-skill ${fmtDist(firstSkill)}`,
        `skill-md-bytes ${fmtDist(bytes, fmtK)}`,
        `turn ${fmtDist(dur)}`,
        `out-tok ${fmtDist(outTok, fmtK)}`,
        `in-tok(all) ${fmtDist(inTok, fmtK)}`,
        hookWall.length > 0 ? `hook-wall ${fmtDist(hookWall)}` : null
      ].filter(Boolean)
      console.log(`  ${arm.padEnd(10)} ${cols.join(' · ')}`)
      if (f.negativeControl) {
        const invokedTurns = ts.filter((t) => t.skillCalls.some((c) => !c.denied)).length
        console.log(`  ${''.padEnd(10)} abstained in ${ts.length - invokedTurns}/${ts.length} turns`)
      }
    }
    console.log()
  }

  console.log('per session (paired by rep; delta = router − no-router)')
  for (let rep = 1; rep <= reps; rep++) {
    for (let i = 0; i < sessionPlans.length; i++) {
      const pair = ['no-router', 'router'].map((arm) =>
        sessions.find((s) => s.arm === arm && s.rep === rep && s.turns[0]?.fixture === sessionPlans[i]![0]!.id)
      )
      const [a, b] = pair
      if (!a || !b) continue
      const line = (s: SessionRecord) =>
        `${s.arm.padEnd(10)} ${s.endedBy.padEnd(9)} cost ${fmtUsd(s.totalCostUsd)} · skill-md-bytes ${fmtK(s.skillMdBytesLoaded)}` +
        ` · wall ${fmtMs(s.durationMs)} · turns ${s.turns.filter((t) => t.endedBy === 'completed').length}/${s.turns.length}` +
        (s.arm === 'router' && s.gateRejudges.length ? ` · gate-rejudges ${s.gateRejudges.length}` : '')
      console.log(`  rep ${rep}${perFixture ? ` ${sessionPlans[i]![0]!.id}` : ''}`)
      console.log(`    ${line(a)}\n    ${line(b)}`)
      if (a.totalCostUsd !== null && b.totalCostUsd !== null)
        console.log(
          `    delta      cost ${fmtUsd(b.totalCostUsd - a.totalCostUsd)} · skill-md-bytes ${fmtK(b.skillMdBytesLoaded - a.skillMdBytesLoaded)}` +
            ` · wall ${fmtMs(b.durationMs - a.durationMs)}`
        )
    }
  }

  const contaminated = sessions.flatMap((s) => s.turns.filter((t) => t.contaminated).map((t) => `${s.arm}#${s.rep}/${t.fixture}`))
  if (contaminated.length > 0)
    console.error(`CONTAMINATION: no-router turn(s) show a hook state file — results invalid: ${contaminated.join(', ')}`)
  const silent = sessions.flatMap((s) =>
    s.arm === 'router' ? s.turns.filter((t) => t.endedBy === 'completed' && !t.hookVerdict).map((t) => `#${s.rep}/${t.fixture}`) : []
  )
  if (silent.length > 0)
    console.error(`HOOK SILENT: router turn(s) produced no verdict state (hook failed silently): ${silent.join(', ')}`)
  const truncated = sessions.filter((s) => s.endedBy !== 'completed')
  if (truncated.length > 0)
    console.error(
      `TRUNCATED: ${truncated.map((s) => `${s.arm}#${s.rep} (${s.endedBy})`).join(', ')} — session totals for these pairs are not comparable`
    )
}

// ---------------------------------------------------------------------------
// main

const repoGitSha = gitSha()
const { notes, degraded, installedSkillCount, routableSkillCount, skillMdBytes } = preflight()
console.log('session-bench preflight:')
for (const n of notes) console.log(`  ${n}`)
const totalSessions = sessionPlans.length * reps * 2
const totalTurns = fixtures.length * reps * 2
console.log(
  `\nPlan: ${sessionPlans.length} session(s) × ${reps} reps × 2 arms = ${totalSessions} headless sessions, ${totalTurns} turns (model=${model}).` +
    `\nRouter-arm Noul cost ≈ ${fixtures.length * reps} turns × ${routableSkillCount} routed skills, plus gate re-judges.\n`
)
if (bools.has('dry-run')) {
  for (const f of fixtures) console.log(`  ${f.id}: "${f.prompt.slice(0, 80)}..."`)
  console.log('\nDry run — nothing launched.')
  process.exit(0)
}

const sessions: SessionRecord[] = []
for (let rep = 1; rep <= reps; rep++) {
  for (const plan of sessionPlans) {
    resetWorkspace('router')
    resetWorkspace('no-router')
    process.stdout.write(`[rep ${rep}/${reps}] ${plan.map((f) => f.id).join(' → ')} … `)
    const [a, b] = await Promise.all([
      runSession(plan, 'no-router', rep, skillMdBytes),
      runSession(plan, 'router', rep, skillMdBytes)
    ])
    sessions.push(a, b)
    const brief = (s: SessionRecord) =>
      `${s.arm}: ` +
      s.turns
        .map((t) => {
          const f = plan[t.turnIndex]!
          return `${t.fixture} ${t.hits.length}/${f.expected.length}${t.junkInvoked.length ? ` junk ${t.junkInvoked.join('/')}` : ''}${t.deniedCount ? ` denied ${t.deniedCount}` : ''}`
        })
        .join(' | ') +
      ` (${s.endedBy}, ${fmtUsd(s.totalCostUsd)}, ${fmtMs(s.durationMs)})`
    console.log(`\n    ${brief(a)}\n    ${brief(b)}`)
  }
}

mkdirSync(outDir, { recursive: true })
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const outFile = join(outDir, `bench-${stamp}.json`)
writeFileSync(
  outFile,
  JSON.stringify(
    {
      meta: {
        date: new Date().toISOString(),
        model,
        reps,
        mode: perFixture ? 'per-fixture' : 'multi-turn',
        stopRule: { symmetric: true, maxSteps, turnTimeoutMs },
        hooks: 'dist/hooks (released bundles)',
        armConfig: ARM_CONFIG,
        allowedTools,
        settingSources: 'project',
        gitSha: repoGitSha,
        installedSkillCount,
        routableSkillCount,
        degraded: degraded.length > 0 ? degraded : undefined,
        preflightNotes: notes,
        fixtures: fixtures.map((f) => ({ id: f.id, expected: f.expected, acceptable: f.acceptable }))
      },
      sessions
    },
    null,
    2
  )
)
summarize(sessions)
console.log(`wrote ${outFile}`)
