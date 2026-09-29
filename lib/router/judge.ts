import type { Skill, SessionState } from '../skills/types.js'

// The swap seam. A JevJudge answers ONE Jev-shaped question per candidate skill:
// a Noul — "given this session, should skill X be invoked?" → probability in [0,1].
// The mock and the (future) real TypeSafe SDK both implement this identical interface,
// so the router, bench, and web demo never know which one they're driving.

export interface JudgeRequest {
  session: SessionState
  /** One shard of candidate skills (<= shardSize). */
  candidates: Skill[]
}

export interface JudgeResult {
  /** skill.id → p(should invoke). One entry per candidate. */
  probabilities: Map<string, number>
  /** Wall-clock for a real judge; a modeled estimate for the mock. */
  latencyMs: number
}

export interface JevJudge {
  readonly name: string
  judge(req: JudgeRequest): Promise<JudgeResult>
}
