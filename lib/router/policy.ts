import type { Skill, SkillScore } from '../skills/types.js'

// Policy is deliberately plain code, kept OUT of the model: apply tunable cutoffs
// to the raw Noul probabilities and hand the survivors back to the coding agent.
// Thresholds are calibrated on labeled data, not universal — changing one never
// requires re-running Jev, because the probabilities are unchanged (see TypeSafe docs).
//
// Two bands, one cap:
//   invoke   p >= threshold, top maxSelected by probability — load these skills.
//   suggest  suggestFloor <= p < threshold, plus above-threshold overflow past the
//            cap — surface by NAME only. On real catalogs this band holds secondary
//            intents and suite leaves dominated by an orchestrator; naming them is
//            nearly free under progressive disclosure, invoking them is not.

export interface PolicyOptions {
  threshold: number
  /** Floor of the suggest band. Omit to disable suggestions. */
  suggestFloor?: number
  /** Hard cap on invoked skills (bloat guard, not a quality mechanism). */
  maxSelected?: number
}

export interface PolicyResult {
  selected: Skill[]
  suggested: Skill[]
  threshold: number
}

export function applyPolicy(scored: SkillScore[], options: PolicyOptions): PolicyResult {
  const { threshold, suggestFloor, maxSelected } = options
  const ranked = scored
    .filter((s): s is SkillScore & { probability: number } => s.probability !== null)
    .sort((a, b) => b.probability - a.probability)

  const above = ranked.filter((s) => s.probability >= threshold)
  const cap = maxSelected ?? above.length
  const selected = above.slice(0, cap).map((s) => s.skill)
  const overflow = above.slice(cap)
  const band =
    suggestFloor !== undefined
      ? ranked.filter((s) => s.probability >= suggestFloor && s.probability < threshold)
      : []
  const suggested = [...overflow, ...band].map((s) => s.skill)

  return { selected, suggested, threshold }
}
