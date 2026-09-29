import type { JevJudge, JudgeRequest, JudgeResult } from './judge.js'

// The THIRD judge — a drop-in twin of createMockJudge()/createJevJudge() that answers
// judge() by lookup in captured real-Jev results. This is the honest-demo primitive:
// the demo drives the REAL router pipeline (judge → policy) end to end, and only the
// judgment underneath is pre-paid. Deterministic, no key, no network.
//
// Honesty contract, fail-loud on both edges:
//   - a session query with no recording is an error, never a guess. The recorded
//     judge can only replay what Jev actually said; it must not improvise.
//   - a candidate missing from the recorded probabilities is an error too — it means
//     the caller's catalog drifted from what the capture judged.
// Curated demos therefore pin their catalog + settings to the capture's.

export interface RecordedRun {
  /** The exact session latestQuery this run was captured for (lookup key). */
  query: string
  /** skill id → p(should invoke), as the real judge returned them. */
  probabilities: Record<string, number>
  /** Captured wall-clock of the original run, replayed as modeled latency. */
  latencyMs: number
}

export function createRecordedJudge(runs: RecordedRun[]): JevJudge {
  const byQuery = new Map(runs.map((r) => [r.query, r]))
  return {
    name: 'recorded',
    async judge({ session, candidates }: JudgeRequest): Promise<JudgeResult> {
      const run = byQuery.get(session.latestQuery)
      if (!run) {
        throw new Error(
          `recorded judge: no recording for query "${session.latestQuery.slice(0, 80)}…" — ` +
            `the recorded judge replays captured runs, it never improvises`
        )
      }
      const probabilities = new Map<string, number>()
      const missing: string[] = []
      for (const skill of candidates) {
        const p = run.probabilities[skill.id]
        if (typeof p === 'number') probabilities.set(skill.id, p)
        else missing.push(skill.id)
      }
      if (missing.length > 0) {
        throw new Error(
          `recorded judge: ${missing.length} candidate(s) absent from the recording for this query ` +
            `(${missing.join(', ')}) — the catalog drifted from what the capture judged`
        )
      }
      return { probabilities, latencyMs: run.latencyMs }
    }
  }
}

/**
 * Adapt one eval-capture recording (fixtures/recordings/<catalog>-<fixture>.json)
 * into a RecordedRun. Every skill was judged in the capture, so any candidate subset
 * can be served. Returns null for files that carry no probabilities (or other
 * recording kinds entirely).
 */
export function runFromEvalRecording(rec: unknown): RecordedRun | null {
  const r = rec as {
    query?: string
    run?: { probabilities?: Record<string, number>; latencyMs?: number } | null
  }
  if (typeof r?.query !== 'string') return null
  if (!r.run?.probabilities) return null
  return {
    query: r.query,
    probabilities: r.run.probabilities,
    latencyMs: typeof r.run.latencyMs === 'number' ? r.run.latencyMs : 0
  }
}
