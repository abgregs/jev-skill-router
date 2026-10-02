// Core types shared by the headless benchmark and the web demo, so both drive the
// exact same router — one router, two surfaces.

/** A single agent skill, loaded from a SKILL.md or synthesized for benchmarks. */
export interface Skill {
  /** Folder slug, unique within a scope (e.g. "better-colors"). */
  id: string
  name: string
  description: string
  scope: 'global' | 'project' | 'synced' | 'synthetic'
  /** Absolute path to the SKILL.md, or a synthetic marker. */
  source: string
  /** Lowercased tokens derived from name+description — the mock judge and the
   *  doctor's static similarity checks read these; the real judge reads the text. */
  keywords: string[]
}

/**
 * The current coding-agent session, as state handed to Jev. Most-recent turn is
 * weighted highest by the caller when composing `transcript`.
 */
export interface SessionState {
  /** Recent conversation turns, most-recent-first, already trimmed by the caller. */
  transcript: string
  /** The user's latest message — the strongest routing signal. */
  latestQuery: string
}

/** One skill's routing verdict. */
export interface SkillScore {
  skill: Skill
  /**
   * Jev Noul probability that this skill *should be invoked* for the session,
   * in [0,1]. `null` when the skill was not judged (e.g. absent from a replayed
   * recording's candidate set).
   */
  probability: number | null
  /** Whether this skill was sent to Jev. */
  judged: boolean
}

export interface RouteResult {
  /** Every catalog skill, ranked by probability desc (unjudged sink to the bottom). */
  scored: SkillScore[]
  /** Skills at or above `threshold` (capped at `maxSelected`) — invoke these. */
  selected: Skill[]
  /**
   * Skills worth surfacing by NAME but not auto-invoking: the suggestFloor..threshold
   * band plus any above-threshold overflow past `maxSelected`. Under progressive
   * disclosure a name costs almost nothing; a body does not.
   */
  suggested: Skill[]
  threshold: number
  /** How many skills actually hit Jev — the cost proxy the bench reports. */
  judgedCount: number
  /** Number of parallel Jev requests the judgment was sharded across. */
  shards: number
  latencyMs: number
}

export interface RouteOptions {
  /** Auto-invoke cutoff on Noul probability. Calibrate on labeled data; not universal. */
  threshold?: number
  /** Floor of the suggest band (suggestFloor <= p < threshold → suggested, not invoked). */
  suggestFloor?: number
  /** Hard cap on invoked skills; above-threshold overflow demotes to suggested. */
  maxSelected?: number
  /** Max Nouls per Jev request; the catalog is sharded into chunks of this size. */
  shardSize?: number
}

// threshold 0.85 is the recall-biased default calibrated on the real-catalog fixtures
// (100% truth recall; admissions were broad-but-applicable skills). Precision-minded
// hosts set 0.9. maxSelected 6 = the largest genuinely co-applicable set observed.
// shardSize 250: the shard sweep (bench/results/shard-sweep-2026-09-22) measured
// latency flat across shard sizes at real catalog scale while every extra shard
// re-pays the session state in input tokens — so a real catalog rides one request,
// and sharding stays purely the mechanism for catalogs past this size.
export const DEFAULT_ROUTE_OPTIONS = {
  threshold: 0.85,
  suggestFloor: 0.8,
  maxSelected: 6,
  shardSize: 250
} as const
