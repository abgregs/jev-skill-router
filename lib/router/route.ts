import type { Skill, SessionState, SkillScore, RouteResult, RouteOptions } from '../skills/types.js'
import { DEFAULT_ROUTE_OPTIONS } from '../skills/types.js'
import type { JevJudge } from './judge.js'
import { applyPolicy } from './policy.js'

// The orchestrator, shared by the bench and the web demo (one router, two surfaces):
//   1. JUDGE   — one Jev Noul per skill, sharded and run in parallel
//   2. POLICY  — threshold + rank in plain code
// Every skill is judged, every time. Nouls are independent judgments — no candidate
// ever needs to see another to be scored — so splitting the catalog across parallel
// requests is semantically lossless, and wall-clock stays ≈ one shard no matter how
// large the catalog grows. That is what scales this past the 255 `Choice` cap.

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

export async function route(
  session: SessionState,
  skills: Skill[],
  judge: JevJudge,
  options: RouteOptions = {}
): Promise<RouteResult> {
  const threshold = options.threshold ?? DEFAULT_ROUTE_OPTIONS.threshold
  const suggestFloor = options.suggestFloor ?? DEFAULT_ROUTE_OPTIONS.suggestFloor
  const maxSelected = options.maxSelected ?? DEFAULT_ROUTE_OPTIONS.maxSelected
  const shardSize = options.shardSize ?? DEFAULT_ROUTE_OPTIONS.shardSize
  const started = performance.now()

  // 1. Shard the catalog and judge shards in parallel — the two-level fan-out
  //    (many Nouls per request; many requests concurrent). Wall-clock ≈ slowest shard.
  const shards = chunk(skills, shardSize)
  const judgeStarted = performance.now()
  const shardResults = await Promise.all(shards.map((c) => judge.judge({ session, candidates: c })))
  const judgeWallMs = performance.now() - judgeStarted

  const probability = new Map<string, number>()
  let slowestShardMs = 0
  for (const result of shardResults) {
    for (const [id, p] of result.probabilities) probability.set(id, p)
    slowestShardMs = Math.max(slowestShardMs, result.latencyMs)
  }

  // 2. Assemble every catalog skill, ranked by probability.
  const scored: SkillScore[] = skills.map((skill) => ({
    skill,
    probability: probability.has(skill.id) ? (probability.get(skill.id) as number) : null,
    judged: probability.has(skill.id)
  }))
  scored.sort((a, b) => (b.probability ?? -1) - (a.probability ?? -1))

  const { selected, suggested } = applyPolicy(scored, { threshold, suggestFloor, maxSelected })

  return {
    scored,
    selected,
    suggested,
    threshold,
    judgedCount: skills.length, // Nouls billed — the real cost proxy
    shards: shards.length,
    // Real judges block in Promise.all, so judgeWallMs already covers the slowest shard
    // and this is plain wall-clock. Modeled judges (mock/recorded) resolve instantly with
    // a reported latency, so their slowest shard substitutes for the ~0 judge wall.
    latencyMs: Math.round(performance.now() - started - judgeWallMs + Math.max(judgeWallMs, slowestShardMs))
  }
}
