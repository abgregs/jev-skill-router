// A/B benchmark: does the router hook get a REAL Claude Code session to the right
// skills faster (and with less deliberation) than stock skill selection?
//
// Two scratch workspaces, identical except .claude/settings.json: one wires the
// UserPromptSubmit router + PreToolUse gate, the other wires nothing. Both arms run
// with --setting-sources project so the user's global hook wiring cannot contaminate
// the no-router arm. For each fixture × rep, BOTH arms launch simultaneously (paired
// design — same network weather), each as a headless `claude -p` whose stream-json
// output is parsed live with client-side timestamps.
//
// Per run we record: time to first Skill invocation, time to all expected skills,
// invoked-vs-truth (hits / acceptable / junk), gate denials, assistant tokens emitted
// before the first Skill call, and — router arm only — the hook's own verdict and
// latency from its state file (the hook's cost is reported, not hidden).
//
//   npm run bench:session -- --dry-run
//   npm run bench:session -- --fixtures build-animation --reps 1 --model haiku
//   npm run bench:session -- --reps 3 --model sonnet
//
// Cost is REAL on both meters: each router-arm run spends ~one Noul per judged skill
// (every installed skill judged), and every run is a real Claude
// session. Runs are capped by --max-turns and killed early once measurements land.
import { execFileSync, spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BENCH_FIXTURES, type BenchFixture } from '../fixtures/bench-sessions.js'
import { loadSkills } from '../lib/skills/loadSkills.js'

const ROUTER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const STATE_DIR = join(tmpdir(), 'jev-skill-router')

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
  /** ms from spawn to the assistant message carrying this tool_use. */
  atMs: number
  denied: boolean
  deniedReason?: string
  resolved: boolean
}

interface RunRecord {
  fixture: string
  arm: Arm
  rep: number
  sessionId: string | null
  model: string | null
  endedBy: 'completed' | 'expected-satisfied' | 'turn-cap' | 'timeout' | 'spawn-error'
  durationMs: number
  spawnToInitMs: number | null
  spawnToFirstAssistantMs: number | null
  firstSkillMs: number | null
  /** ms until every expected skill had a non-denied invocation; null if never. */
  allExpectedMs: number | null
  skillCalls: SkillCall[]
  hits: string[]
  missed: string[]
  acceptableInvoked: string[]
  junkInvoked: string[]
  deniedCount: number
  assistantTurns: number
  /** Full assistant output tokens in messages BEFORE the one carrying the first Skill call. */
  tokensBeforeFirstSkill: number | null
  /** Text chars preceding the first Skill tool_use inside its own message. */
  charsBeforeFirstSkillInMessage: number | null
  /** Router arm only: the hook's persisted verdict (includes its own latencyMs). */
  hookVerdict: Record<string, unknown> | null
  /** No-router arm: true if a hook state file appeared anyway — arm contamination. */
  contaminated: boolean
  totalCostUsd: number | null
  /** Aggregate input tokens across all assistant messages (always recorded, even on killed runs). */
  inputTokens: number | null
  /** Aggregate output tokens across all assistant messages (always recorded, even on killed runs). */
  outputTokens: number | null
  /** Aggregate cache_read_input_tokens across all assistant messages. */
  cacheReadTokens: number | null
  /** Aggregate cache_creation_input_tokens across all assistant messages. */
  cacheCreationTokens: number | null
  /** Hook wall-time from estimated process start to state-file write (router arm only). */
  hookWallMs: number | null
  /** Wall-time of the execFileSync call to route-cli.ts (router arm only). */
  routerCliMs: number | null
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
const maxTurns = opts['max-turns'] ? Number(opts['max-turns']) : 4
const timeoutMs = opts['timeout-ms']
  ? Number(opts['timeout-ms'])
  : (opts['timeout-sec'] ? Number(opts['timeout-sec']) : 240) * 1000
const claudeBin = opts['claude-bin'] ?? 'claude'
const workRoot = opts['work-root'] ?? join(tmpdir(), 'jev-session-bench')
const outDir = resolve(ROUTER_DIR, opts.out ?? 'bench/session-results')
const allowedTools = ['Skill', 'Read', 'Glob', 'Grep', 'Write', 'Edit', 'TodoWrite', 'Bash(git:*)']

const fixtureFilter = opts.fixtures?.split(',').map((x) => x.trim())
const fixtures = fixtureFilter
  ? BENCH_FIXTURES.filter((f) => fixtureFilter.includes(f.id))
  : BENCH_FIXTURES
if (fixtures.length === 0) {
  console.error(`No matching fixtures. Available: ${BENCH_FIXTURES.map((f) => f.id).join(', ')}`)
  process.exit(1)
}

// ---------------------------------------------------------------------------
// preflight — fail loud on anything that would silently bias an arm

interface PreflightResult {
  notes: string[]
  /** Human-readable degraded states (non-jev judge, missing skills) to stamp into meta. */
  degraded: string[]
  /** Judge name from ~/.skillrouter.json (or 'jev' if absent/unconfigured). */
  judgeType: string
  installedSkillCount: number
  routableSkillCount: number
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

  // The hook resolves ~/.skillrouter.json — record which judge the bench actually measures.
  const homeCfg = join(homedir(), '.skillrouter.json')
  let judgeType = 'jev'
  if (existsSync(homeCfg)) {
    try {
      const cfg = JSON.parse(readFileSync(homeCfg, 'utf8'))
      notes.push(`~/.skillrouter.json: ${JSON.stringify(cfg)}`)
      judgeType = cfg.judge ?? 'jev'
      if (judgeType !== 'jev') {
        const msg = `~/.skillrouter.json judge=${judgeType} — benchmarking ${judgeType} judge, not Jev`
        console.warn(`WARNING: ${msg}.`)
        degraded.push(msg)
      }
    } catch {
      const msg = '~/.skillrouter.json is unparseable; route-cli will fail loud on it'
      console.warn(`WARNING: ${msg}.`)
      degraded.push(msg)
    }
  } else notes.push('~/.skillrouter.json: absent (router defaults, judge=jev)')

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
  const routableSkillCount = loadSkills().length
  notes.push(`routable skills (loadSkills): ${routableSkillCount}`)
  return { notes, degraded, judgeType, installedSkillCount, routableSkillCount }
}

// ---------------------------------------------------------------------------
// workspaces

function armDir(arm: Arm): string {
  return join(workRoot, arm)
}

// Every fixture prompt references project state (a toast component, staged changes, a
// Swift module). An EMPTY workspace makes the model hunt for missing files instead of
// invoking skills — so both arms get the SAME tiny stub project, reset before every
// paired run so one rep's writes cannot leak into the next.
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
  const tsxBin = join(ROUTER_DIR, 'node_modules', '.bin', 'tsx')
  const hookCmd = (script: string) => `${tsxBin} ${join(ROUTER_DIR, 'hooks', script)}`
  const settings =
    arm === 'router'
      ? {
          hooks: {
            UserPromptSubmit: [{ hooks: [{ type: 'command', command: hookCmd('user-prompt-submit.ts') }] }],
            PreToolUse: [
              { matcher: 'Skill', hooks: [{ type: 'command', command: hookCmd('pre-tool-use-gate.ts') }] }
            ]
          }
        }
      : {}
  const dir = armDir(arm)
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(join(dir, '.claude'), { recursive: true })
  writeFileSync(join(dir, '.claude', 'settings.json'), JSON.stringify(settings, null, 2))
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
// one headless session

function runOne(fixture: BenchFixture, arm: Arm, rep: number): Promise<RunRecord> {
  return new Promise((resolvePromise) => {
    const t0 = Date.now()
    const rec: RunRecord = {
      fixture: fixture.id,
      arm,
      rep,
      sessionId: null,
      model: null,
      endedBy: 'completed',
      durationMs: 0,
      spawnToInitMs: null,
      spawnToFirstAssistantMs: null,
      firstSkillMs: null,
      allExpectedMs: null,
      skillCalls: [],
      hits: [],
      missed: [],
      acceptableInvoked: [],
      junkInvoked: [],
      deniedCount: 0,
      assistantTurns: 0,
      tokensBeforeFirstSkill: null,
      charsBeforeFirstSkillInMessage: null,
      hookVerdict: null,
      contaminated: false,
      totalCostUsd: null,
      inputTokens: null,
      outputTokens: null,
      cacheReadTokens: null,
      cacheCreationTokens: null,
      hookWallMs: null,
      routerCliMs: null,
      stderrTail: ''
    }

    const child = spawn(
      claudeBin,
      [
        '-p',
        fixture.prompt,
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
      { cwd: armDir(arm), env: process.env, stdio: ['ignore', 'pipe', 'pipe'] }
    )

    let killed = false
    // stream-json emits one assistant event PER CONTENT BLOCK; a real API turn is the
    // set of events sharing message.id. Count turns and tokens per id, not per event.
    const msgTokens = new Map<string, number>() // message.id → last-seen output_tokens
    const msgInputTokens = new Map<string, number>() // message.id → last-seen input_tokens
    const msgCacheReadTokens = new Map<string, number>() // message.id → last-seen cache_read_input_tokens
    const msgCacheCreationTokens = new Map<string, number>() // message.id → last-seen cache_creation_input_tokens
    const msgChars = new Map<string, number>() // message.id → text chars streamed so far
    const pending = new Map<string, SkillCall>() // toolUseId → call awaiting its result
    const kill = (why: RunRecord['endedBy']) => {
      if (killed) return
      killed = true
      rec.endedBy = why
      child.kill('SIGTERM')
      setTimeout(() => child.kill('SIGKILL'), 5000).unref()
    }
    const timer = setTimeout(() => kill('timeout'), timeoutMs)

    const expectedSatisfied = () =>
      fixture.expected.length > 0 &&
      fixture.expected.every((id) =>
        rec.skillCalls.some((c) => c.skill === id && c.resolved && !c.denied)
      )

    child.stderr.on('data', (d: Buffer) => {
      rec.stderrTail = (rec.stderrTail + d.toString()).slice(-2000)
    })
    child.on('error', () => {
      rec.endedBy = 'spawn-error'
      finish()
    })

    const rl = createInterface({ input: child.stdout })
    rl.on('line', (line) => {
      const now = Date.now() - t0
      let e: any
      try {
        e = JSON.parse(line)
      } catch {
        return
      }

      if (e.type === 'system' && e.subtype === 'init') {
        rec.sessionId = e.session_id ?? null
        rec.model = e.model ?? null
        rec.spawnToInitMs = now
        return
      }

      if (e.type === 'assistant' && e.message) {
        if (rec.spawnToFirstAssistantMs === null) rec.spawnToFirstAssistantMs = now
        const msgId: string = e.message.id ?? `anon-${rec.assistantTurns}`
        if (!msgTokens.has(msgId)) {
          rec.assistantTurns++
          msgTokens.set(msgId, 0)
          msgInputTokens.set(msgId, 0)
          msgCacheReadTokens.set(msgId, 0)
          msgCacheCreationTokens.set(msgId, 0)
          msgChars.set(msgId, 0)
          if (rec.assistantTurns > maxTurns) {
            kill('turn-cap')
            return
          }
        }
        const content: any[] = Array.isArray(e.message.content) ? e.message.content : []
        for (const block of content) {
          if (block.type === 'text') msgChars.set(msgId, msgChars.get(msgId)! + (block.text ?? '').length)
          if (block.type === 'tool_use' && block.name === 'Skill') {
            const skill = String(block.input?.skill ?? block.input?.command ?? '')
            if (rec.firstSkillMs === null) {
              rec.firstSkillMs = now
              // Tokens of every PRIOR message + text streamed earlier in this one.
              let before = 0
              for (const [id, tok] of msgTokens) if (id !== msgId) before += tok
              rec.tokensBeforeFirstSkill = before
              rec.charsBeforeFirstSkillInMessage = msgChars.get(msgId)!
            }
            const call: SkillCall = { skill, toolUseId: block.id, atMs: now, denied: false, resolved: false }
            rec.skillCalls.push(call)
            pending.set(block.id, call)
          }
        }
        const usage = e.message.usage
        const tok = usage?.output_tokens
        if (typeof tok === 'number' && tok > msgTokens.get(msgId)!) msgTokens.set(msgId, tok)
        const inTok = usage?.input_tokens
        if (typeof inTok === 'number' && inTok > msgInputTokens.get(msgId)!) msgInputTokens.set(msgId, inTok)
        const crTok = usage?.cache_read_input_tokens
        if (typeof crTok === 'number' && crTok > msgCacheReadTokens.get(msgId)!) msgCacheReadTokens.set(msgId, crTok)
        const ccTok = usage?.cache_creation_input_tokens
        if (typeof ccTok === 'number' && ccTok > msgCacheCreationTokens.get(msgId)!) msgCacheCreationTokens.set(msgId, ccTok)
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
            rec.deniedCount++
          }
          pending.delete(block.tool_use_id)
        }
        if (expectedSatisfied()) {
          if (rec.allExpectedMs === null) rec.allExpectedMs = now
          kill('expected-satisfied')
        }
        return
      }

      if (e.type === 'result') {
        rec.totalCostUsd = e.total_cost_usd ?? null
        // natural completion — endedBy stays 'completed' unless already killed
      }
    })

    const finish = () => {
      clearTimeout(timer)
      rec.durationMs = Date.now() - t0
      if (rec.allExpectedMs === null && expectedSatisfied())
        rec.allExpectedMs = Math.max(...rec.skillCalls.filter((c) => !c.denied).map((c) => c.atMs))

      // Aggregate token counts across all assistant messages (always, even on killed runs).
      if (msgTokens.size > 0) {
        rec.outputTokens = [...msgTokens.values()].reduce((a, b) => a + b, 0)
        rec.inputTokens = [...msgInputTokens.values()].reduce((a, b) => a + b, 0)
        rec.cacheReadTokens = [...msgCacheReadTokens.values()].reduce((a, b) => a + b, 0)
        rec.cacheCreationTokens = [...msgCacheCreationTokens.values()].reduce((a, b) => a + b, 0)
      }

      // Score invocations against curated truth. A denied call is not a hit.
      const invoked = new Set(rec.skillCalls.filter((c) => !c.denied).map((c) => c.skill))
      rec.hits = fixture.expected.filter((id) => invoked.has(id))
      rec.missed = fixture.expected.filter((id) => !invoked.has(id))
      rec.acceptableInvoked = [...invoked].filter((id) => fixture.acceptable.includes(id))
      rec.junkInvoked = [...invoked].filter(
        (id) => !fixture.expected.includes(id) && !fixture.acceptable.includes(id)
      )

      // Hook verdict (router arm) / contamination check (no-router arm).
      // Also extract hookWallMs and routerCliMs from state file (Fix C).
      if (rec.sessionId) {
        const statePath = join(STATE_DIR, `turn-${rec.sessionId}.json`)
        if (existsSync(statePath)) {
          try {
            const verdict = JSON.parse(readFileSync(statePath, 'utf8'))
            if (arm === 'router') {
              rec.hookVerdict = verdict
              if (typeof verdict.hookWallMs === 'number') rec.hookWallMs = verdict.hookWallMs
              if (typeof verdict.routerCliMs === 'number') rec.routerCliMs = verdict.routerCliMs
            } else rec.contaminated = true
          } catch {
            /* unreadable state — leave nulls */
          }
        }
      }
      resolvePromise(rec)
    }
    child.on('close', finish)
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

function fmtDist(xs: number[]): string {
  const m = median(xs)
  if (m === null) return '—'
  const lo = Math.min(...xs)
  const hi = Math.max(...xs)
  return `${fmtMs(m)} (${fmtMs(lo)}–${fmtMs(hi)})`
}

function summarize(runs: RunRecord[]): void {
  console.log('\n================= SESSION BENCH SUMMARY =================')
  console.log(`model=${model} · reps=${reps} · max-turns=${maxTurns} · paired launches\n`)
  for (const f of fixtures) {
    console.log(`${f.id}${f.negativeControl ? '  [negative control — correct outcome: no skills]' : ''}`)
    console.log(`  expected: [${f.expected.join(', ') || 'none'}]`)
    for (const arm of ['no-router', 'router'] as Arm[]) {
      const rs = runs.filter((r) => r.fixture === f.id && r.arm === arm && r.endedBy !== 'spawn-error')
      if (rs.length === 0) {
        console.log(`  ${arm.padEnd(10)} no valid runs`)
        continue
      }
      const firstSkill = rs.filter((r) => r.firstSkillMs !== null).map((r) => r.firstSkillMs!)
      const allExp = rs.filter((r) => r.allExpectedMs !== null).map((r) => r.allExpectedMs!)
      const hitRate =
        f.expected.length === 0
          ? null
          : rs.reduce((a, r) => a + r.hits.length, 0) / (rs.length * f.expected.length)
      const junk = rs.reduce((a, r) => a + r.junkInvoked.length, 0)
      const denied = rs.reduce((a, r) => a + r.deniedCount, 0)
      const tokens = rs.filter((r) => r.tokensBeforeFirstSkill !== null).map((r) => r.tokensBeforeFirstSkill!)
      const gap = rs.filter((r) => r.spawnToFirstAssistantMs !== null).map((r) => r.spawnToFirstAssistantMs!)
      const hookLat = rs
        .map((r) => (typeof r.hookVerdict?.latencyMs === 'number' ? (r.hookVerdict.latencyMs as number) : null))
        .filter((x): x is number => x !== null)
      const hookWall = rs.filter((r) => r.hookWallMs !== null).map((r) => r.hookWallMs!)
      const cols = [
        `n=${rs.length}`,
        `first-skill ${fmtDist(firstSkill)}`,
        f.expected.length > 0 ? `all-expected ${fmtDist(allExp)} [${allExp.length}/${rs.length} runs]` : null,
        hitRate === null ? null : `hits ${(hitRate * 100).toFixed(0)}%`,
        `junk ${junk}`,
        denied > 0 ? `gate-denied ${denied}` : null,
        `pre-skill-tokens ${median(tokens) ?? '—'}`,
        `spawn→assistant ${fmtDist(gap)}`,
        // Relabeled: this is the jev-network self-report only, NOT the full hook cost.
        hookLat.length > 0 ? `hook-jev-network-latency(self-report) ${fmtDist(hookLat)}` : null,
        hookWall.length > 0 ? `hook-wall(process-start→write) ${fmtDist(hookWall)}` : null
      ].filter(Boolean)
      console.log(`  ${arm.padEnd(10)} ${cols.join(' · ')}`)
      if (f.negativeControl) {
        const invokedRuns = rs.filter((r) => r.skillCalls.some((c) => !c.denied)).length
        console.log(`  ${''.padEnd(10)} abstained in ${rs.length - invokedRuns}/${rs.length} runs`)
      }
    }

    // Hook overhead as paired delta: router spawnToInitMs minus no-router spawnToInitMs
    // gives the externally-observable cost of the hook per fixture.
    const routerInits = runs
      .filter((r) => r.fixture === f.id && r.arm === 'router' && r.spawnToInitMs !== null)
      .map((r) => r.spawnToInitMs!)
    const noRouterInits = runs
      .filter((r) => r.fixture === f.id && r.arm === 'no-router' && r.spawnToInitMs !== null)
      .map((r) => r.spawnToInitMs!)
    if (routerInits.length > 0 && noRouterInits.length > 0) {
      // Pair by rep order (both arrays are populated in the same rep order).
      const deltas = routerInits
        .slice(0, Math.min(routerInits.length, noRouterInits.length))
        .map((v, i) => v - noRouterInits[i]!)
        .filter((d) => isFinite(d))
      if (deltas.length > 0)
        console.log(`  hook-overhead(spawnToInit router-minus-no-router) ${fmtDist(deltas)}`)
    }
    console.log()
  }
  const contaminated = runs.filter((r) => r.contaminated)
  if (contaminated.length > 0)
    console.error(
      `CONTAMINATION: ${contaminated.length} no-router run(s) show a hook state file — results invalid: ` +
        contaminated.map((r) => `${r.fixture}#${r.rep}`).join(', ')
    )
  const routerNoVerdict = runs.filter((r) => r.arm === 'router' && r.endedBy !== 'spawn-error' && !r.hookVerdict)
  if (routerNoVerdict.length > 0)
    console.error(
      `HOOK SILENT: ${routerNoVerdict.length} router run(s) produced no verdict state (hook failed silently): ` +
        routerNoVerdict.map((r) => `${r.fixture}#${r.rep}`).join(', ')
    )
}

// ---------------------------------------------------------------------------
// main

const repoGitSha = gitSha()
const preflight_ = preflight()
const { notes, degraded, judgeType, installedSkillCount, routableSkillCount } = preflight_
console.log('session-bench preflight:')
for (const n of notes) console.log(`  ${n}`)
const totalRuns = fixtures.length * reps * 2
console.log(
  `\nPlan: ${fixtures.length} fixtures × ${reps} reps × 2 arms = ${totalRuns} headless sessions (model=${model}).` +
    `\nRouter-arm Noul cost ≈ ${fixtures.length * reps} runs × one Noul per installed skill (see preflight count).\n`
)
if (bools.has('dry-run')) {
  for (const f of fixtures) console.log(`  ${f.id}: "${f.prompt.slice(0, 80)}..."`)
  console.log('\nDry run — nothing launched.')
  process.exit(0)
}

const runs: RunRecord[] = []
for (let rep = 1; rep <= reps; rep++) {
  for (const fixture of fixtures) {
    resetWorkspace('router')
    resetWorkspace('no-router')
    process.stdout.write(`[rep ${rep}/${reps}] ${fixture.id} … `)
    const [a, b] = await Promise.all([runOne(fixture, 'no-router', rep), runOne(fixture, 'router', rep)])
    runs.push(a, b)
    const brief = (r: RunRecord) =>
      `${r.arm}: first-skill ${fmtMs(r.firstSkillMs)}, hits ${r.hits.length}/${fixture.expected.length}` +
      `${r.junkInvoked.length ? `, junk ${r.junkInvoked.join('/')}` : ''}` +
      `${r.deniedCount ? `, denied ${r.deniedCount}` : ''} (${r.endedBy})`
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
        maxTurns,
        allowedTools,
        settingSources: 'project',
        gitSha: repoGitSha,
        judgeType,
        installedSkillCount,
        routableSkillCount,
        degraded: degraded.length > 0 ? degraded : undefined,
        preflightNotes: notes,
        fixtures: fixtures.map((f) => ({ id: f.id, expected: f.expected, acceptable: f.acceptable }))
      },
      runs
    },
    null,
    2
  )
)
summarize(runs)
console.log(`wrote ${outFile}`)
