import type { JevJudge, JudgeRequest, JudgeResult } from './judge.js'
import { tokenize } from '../skills/loadSkills.js'
import type { Skill, SessionState } from '../skills/types.js'

// A DETERMINISTIC stand-in for Jev — zero network, zero cost. It approximates a Noul
// p(should invoke) with a logistic over weighted keyword overlap, so the full pipeline,
// bench, and web demo run end to end before a real key exists.
//
// HONESTY NOTE: the mock scores on keywords. Real Jev's advantage is SEMANTIC
// understanding beyond keywords, which this mock cannot show — so mock numbers validate
// the plumbing and the fan-out's cost accounting, NOT Jev's true routing quality. Swap
// in the real judge to measure that.

export interface MockJudgeConfig {
  /** Logistic midpoint: overlap score that maps to p≈0.5. */
  mid?: number
  /** Logistic steepness. */
  scale?: number
  /** Modeled per-request fixed latency (ms). */
  baseLatencyMs?: number
  /** Modeled additional latency per Noul in the request (ms). */
  perNoulMs?: number
}

const DEFAULTS: Required<MockJudgeConfig> = {
  mid: 0.3,
  scale: 0.1,
  baseLatencyMs: 220,
  perNoulMs: 4
}

// Keyword weights for this mock only, not a model of how Jev weighs anything: the
// latest message counts three times the transcript tail.
const WEIGHTS = { latestQuery: 3, transcript: 1 }

function sessionTermWeights(session: SessionState): Map<string, number> {
  const weights = new Map<string, number>()
  const add = (text: string | undefined, weight: number) => {
    if (!text) return
    for (const token of tokenize(text)) {
      weights.set(token, (weights.get(token) ?? 0) + weight)
    }
  }
  add(session.latestQuery, WEIGHTS.latestQuery)
  add(session.transcript, WEIGHTS.transcript)
  return weights
}

/**
 * Cosine similarity between the weighted session-term vector and the skill's keyword
 * vector. Cosine (vs raw overlap) normalizes for query length AND is what cleanly
 * separates same-service from wrong-service twins: the correct `*-payments` skill
 * shares the discriminating `payments` mass, its `*-maps` twin does not.
 */
function cosine(termWeights: Map<string, number>, queryNorm: number, skill: Skill): number {
  let dot = 0
  for (const keyword of skill.keywords) dot += termWeights.get(keyword) ?? 0
  if (dot === 0) return 0
  return dot / (queryNorm * Math.sqrt(skill.keywords.length || 1))
}

function logistic(x: number, mid: number, scale: number): number {
  return 1 / (1 + Math.exp(-(x - mid) / scale))
}

export function createMockJudge(config: MockJudgeConfig = {}): JevJudge {
  const cfg = { ...DEFAULTS, ...config }
  return {
    name: 'mock',
    async judge({ session, candidates }: JudgeRequest): Promise<JudgeResult> {
      const termWeights = sessionTermWeights(session)
      let sumSquares = 0
      for (const w of termWeights.values()) sumSquares += w * w
      const queryNorm = Math.sqrt(sumSquares) || 1

      const probabilities = new Map<string, number>()
      for (const skill of candidates) {
        probabilities.set(skill.id, logistic(cosine(termWeights, queryNorm, skill), cfg.mid, cfg.scale))
      }
      return {
        probabilities,
        latencyMs: cfg.baseLatencyMs + cfg.perNoulMs * candidates.length
      }
    }
  }
}
