// Shard-size sweep with the REAL Jev judge: same session, same 65-skill catalog,
// shardSize ∈ {whole-catalog, 50, 25, 10} × 3 reps. Answers two questions the
// defaults have only assumed: does sharding save wall-clock at real catalog sizes,
// and what does it cost in tokens (each shard re-sends the session state)?
//
// Config order rotates per rep so warm-up/drift bias spreads across configs, and one
// untimed warm-up request burns TLS/server cold start before measurement.
//
//   tsx scripts/shard-sweep.ts [fixtureId]     (default: build-animation)
//
// Writes bench/results/shard-sweep-<stamp>.json (the committed keeper dir).
import { existsSync, writeFileSync } from 'node:fs'
import { TypeSafeClient } from '@typesafe-ai/sdk'
import { route } from '../lib/router/index.js'
import { createJevJudge } from '../lib/router/jevJudge.js'
import { loadSkills } from '../lib/skills/loadSkills.js'
import { SESSIONS, fixtureTargets } from '../fixtures/sessions.js'

for (const p of ['.env.local', '../.env.local']) {
  if (!process.env.TYPESAFE_API_KEY && existsSync(p)) process.loadEnvFile(p)
}
if (!process.env.TYPESAFE_API_KEY) {
  console.error('TYPESAFE_API_KEY is unreachable (env or .env.local) — refusing to run.')
  process.exit(1)
}

const wanted = process.argv[2] ?? 'build-animation'
const fixture = SESSIONS.find((s) => s.id === wanted)
if (!fixture || !fixtureTargets(fixture, 'real')) {
  console.error(`No real-catalog fixture "${wanted}". Available: ${SESSIONS.filter((s) => fixtureTargets(s, 'real')).map((s) => s.id).join(', ')}`)
  process.exit(1)
}

const catalog = loadSkills()
const REPS = 3
const SHARD_SIZES = [catalog.length, 50, 25, 10]

// Intercept the client so every systemOne request logs its latency and token usage;
// the judge and route() stay the exact production code path.
interface RequestLog {
  questions: number
  ms: number
  inputTokens: number
  outputTokens: number
}
let currentLog: RequestLog[] = []
const base = new TypeSafeClient()
const capturingClient = {
  systemOne: async (req: Parameters<TypeSafeClient['systemOne']>[0]) => {
    const t0 = performance.now()
    const res = await base.systemOne(req)
    currentLog.push({
      questions: Object.keys(req.questions).length,
      ms: Math.round(performance.now() - t0),
      inputTokens: res.usage.input_tokens,
      outputTokens: res.usage.output_tokens
    })
    return res
  }
} as unknown as TypeSafeClient
const judge = createJevJudge({ client: capturingClient })

interface RunRecord {
  shardSize: number
  rep: number
  shards: number
  wallMs: number
  inputTokens: number
  outputTokens: number
  requests: RequestLog[]
  selected: string[]
}

console.log(`Fixture: ${fixture.id} · catalog ${catalog.length} skills · shard sizes [${SHARD_SIZES.join(', ')}] × ${REPS} reps`)
console.log(`Nouls: ${SHARD_SIZES.length * REPS * catalog.length} + ${catalog.length} warm-up\n`)

// Warm-up: full-catalog request, untimed, result discarded.
await route(fixture.session, catalog, judge, { shardSize: catalog.length })
currentLog = []

const runs: RunRecord[] = []
for (let rep = 0; rep < REPS; rep++) {
  // Rotate order so no config always runs first (or last) within a rep.
  const order = SHARD_SIZES.map((_, i) => SHARD_SIZES[(i + rep) % SHARD_SIZES.length]!)
  for (const shardSize of order) {
    currentLog = []
    const t0 = performance.now()
    const result = await route(fixture.session, catalog, judge, { shardSize })
    const wallMs = Math.round(performance.now() - t0)
    runs.push({
      shardSize,
      rep: rep + 1,
      shards: result.shards,
      wallMs,
      inputTokens: currentLog.reduce((a, r) => a + r.inputTokens, 0),
      outputTokens: currentLog.reduce((a, r) => a + r.outputTokens, 0),
      requests: currentLog,
      selected: result.selected.map((s) => s.id)
    })
    console.log(
      `  rep ${rep + 1} shard=${String(shardSize).padStart(2)} → ${result.shards} req · ` +
        `${wallMs}ms · in ${runs.at(-1)!.inputTokens} out ${runs.at(-1)!.outputTokens} tok · ` +
        `selected [${runs.at(-1)!.selected.join(', ')}]`
    )
  }
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  return s.length % 2 ? s[(s.length - 1) / 2]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2
}

console.log('\n================= SHARD SWEEP SUMMARY =================')
console.log('  shardSize   shards   wall median (min–max)   input tok   output tok')
for (const size of SHARD_SIZES) {
  const rs = runs.filter((r) => r.shardSize === size)
  const walls = rs.map((r) => r.wallMs)
  const inTok = median(rs.map((r) => r.inputTokens))
  const outTok = median(rs.map((r) => r.outputTokens))
  console.log(
    `  ${String(size).padStart(9)}   ${String(rs[0]!.shards).padStart(6)}   ` +
      `${String(Math.round(median(walls))).padStart(6)}ms (${Math.min(...walls)}–${Math.max(...walls)})   ` +
      `${String(Math.round(inTok)).padStart(9)}   ${String(Math.round(outTok)).padStart(10)}`
  )
}

// Semantic-losslessness check: sharding should not change the verdict.
const verdicts = new Set(runs.map((r) => [...r.selected].sort().join(',')))
console.log(
  verdicts.size === 1
    ? `\nVerdict stable across all ${runs.length} runs: [${runs[0]!.selected.join(', ')}]`
    : `\nWARNING: verdict varied across runs (${verdicts.size} distinct selected-sets) — inspect the JSON before trusting one config.`
)

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const outFile = `bench/results/shard-sweep-${stamp}.json`
writeFileSync(
  outFile,
  JSON.stringify(
    { meta: { date: new Date().toISOString(), fixture: fixture.id, catalogSize: catalog.length, reps: REPS, shardSizes: SHARD_SIZES }, runs },
    null,
    2
  )
)
console.log(`wrote ${outFile}`)
