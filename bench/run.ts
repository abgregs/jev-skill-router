// The scale benchmark: run the labeled sessions through the router over the
// ~1080-skill synthetic org catalog — every skill judged, one Noul each, sharded and
// fanned out in parallel. Reports the cost/latency profile (Nouls, shards, modeled
// wall-clock) and quality (precision/recall) at a swept threshold.
//
// Uses the deterministic MOCK judge — so these numbers exercise the PIPELINE and the
// fan-out's cost accounting, not Jev's real routing quality (see mockJudge.ts). Swap in
// the real judge to measure that. Run: npm run bench
import { synthesizeCatalog } from '../lib/skills/synthesize.js'
import { createMockJudge, route } from '../lib/router/index.js'
import { SESSIONS, fixtureTargets } from '../fixtures/sessions.js'
import type { SkillScore, RouteResult } from '../lib/skills/types.js'

const catalog = synthesizeCatalog()
// Only fixtures whose ground truth lives in the synthetic catalog — real-catalog
// fixtures would score structurally-zero here and poison the micro averages.
const BENCH_SESSIONS = SESSIONS.filter((s) => fixtureTargets(s, 'synthetic'))
const judge = createMockJudge()
const SHARD_SIZE = 50
const THRESHOLDS = [0.5, 0.7, 0.8, 0.9, 0.95]

interface Micro { tp: number; selected: number; expected: number }

function tallyAt(scored: SkillScore[], expected: string[], threshold: number, m: Micro): void {
  const expectedSet = new Set(expected)
  const selected = scored.filter((s) => s.probability !== null && s.probability >= threshold)
  m.selected += selected.length
  m.expected += expected.length
  m.tp += selected.filter((s) => expectedSet.has(s.skill.id)).length
}

function prf({ tp, selected, expected }: Micro) {
  const precision = selected ? tp / selected : 1
  const recall = expected ? tp / expected : 1
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0
  return { precision, recall, f1 }
}

const pct = (x: number) => `${(x * 100).toFixed(0)}%`

// Route every session once (captures full `scored`), then evaluate thresholds offline.
const routed: { result: RouteResult; expected: string[] }[] = []
for (const { session, expected } of BENCH_SESSIONS) {
  const result = await route(session, catalog, judge, { shardSize: SHARD_SIZE, threshold: 0.9 })
  routed.push({ result, expected })
}

const avgJudged = routed.reduce((a, r) => a + r.result.judgedCount, 0) / routed.length
const avgShards = routed.reduce((a, r) => a + r.result.shards, 0) / routed.length
const avgLatency = routed.reduce((a, r) => a + r.result.latencyMs, 0) / routed.length

console.log(`Catalog: ${catalog.length} skills · ${BENCH_SESSIONS.length} labeled sessions · shard size ${SHARD_SIZE}\n`)

console.log('COST / LATENCY (per session, averaged)')
console.log(`  Nouls judged ${avgJudged.toFixed(0)} · ${avgShards.toFixed(0)} parallel shards · ${avgLatency.toFixed(0)}ms modeled wall-clock`)
console.log(
  `  → wall-clock ≈ one shard, not ${avgShards.toFixed(0)}: Nouls are independent, so shards run` +
    ` concurrently and the catalog can grow without the latency growing with it.\n`
)

console.log('QUALITY vs threshold (micro precision / recall / F1)')
const sweep = THRESHOLDS.map((t) => {
  const m: Micro = { tp: 0, selected: 0, expected: 0 }
  for (const { result, expected } of routed) tallyAt(result.scored, expected, t, m)
  return { t, ...prf(m) }
})
for (const s of sweep) {
  console.log(`  t=${s.t.toFixed(2)}   P ${pct(s.precision).padStart(4)}   R ${pct(s.recall).padStart(4)}   F1 ${pct(s.f1).padStart(4)}`)
}
console.log('\nNote: mock judge → these validate the pipeline + fan-out cost accounting, not Jev quality.')
