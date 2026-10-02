import { TypeSafeClient, noul } from '@typesafe-ai/sdk'
import type { JsonValue } from '@typesafe-ai/sdk'
import type { JevJudge, JudgeRequest, JudgeResult } from './judge.js'
import type { Skill, SessionState } from '../skills/types.js'

// The REAL judge — the drop-in twin of createMockJudge(), same JevJudge interface.
// Where the mock approximates a Noul with keyword cosine, this asks Jev the actual
// question: one Noul per candidate skill, "given this session, should this skill be
// invoked?" → an independent, thresholdable p(0..1). Noul (not Choice) because several
// skills may apply at once and each needs its own probability — and because Nouls are
// independent, the catalog shards across parallel requests with no semantic loss
// (a Choice caps at 255 options and cannot shard: shard winners would never meet).
//
// One judge() call = one systemOne() request carrying one Noul per candidate in the
// shard. The router shards the catalog and fans these requests out in parallel, so the
// two-level fan-out (many Nouls per request; many requests concurrent) is unchanged —
// only the judgment underneath swaps from mock to Jev.
//
// Question IDs are NOT sent to the model, so each Noul's instructions must carry the
// skill's full meaning (name + description); the session itself rides in `state`.

export interface JevJudgeConfig {
  /**
   * A pre-built TypeSafe client. Omit to construct `new TypeSafeClient()`, which reads
   * the TYPESAFE_API_KEY env var. Injectable so tests/live scripts can supply their own.
   */
  client?: TypeSafeClient
}

/** Build the shared session state handed to Jev, omitting fields the session lacks. */
function toState(session: SessionState): Record<string, JsonValue> {
  // Key names carry the weighting the SessionState contract documents (latestQuery is
  // "the strongest routing signal"; the mock encodes it as 3× vs transcript 1×). In a
  // multi-turn session the transcript tail is dominated by the PREVIOUS task, so it
  // must read as background — flat co-equal keys let it drown out a topic switch.
  const state: Record<string, JsonValue> = { currentRequest: session.latestQuery }
  if (session.transcript) state.earlierConversationBackground = session.transcript
  return state
}

/** The Noul asked per candidate skill. Instructions carry the skill; state carries the session. */
function skillNoul(skill: Skill) {
  return noul(
    `A coding agent has this skill available:\n` +
      `Name: ${skill.name}\n` +
      `What it does: ${skill.description}\n\n` +
      `Should the agent invoke this skill for the user's current request (currentRequest)? ` +
      `Judge against the current request alone; earlierConversationBackground is context ` +
      `from preceding turns and often describes prior tasks already finished.`,
    {
      true: 'The current request clearly calls for this skill.',
      // No "a different skill fits better" clause: this Noul sees only its own skill,
      // so it cannot judge that comparison.
      false:
        'This skill is unrelated to the current request — even if earlier conversation ' +
        'touched its domain.'
    }
  )
}

export function createJevJudge(config: JevJudgeConfig = {}): JevJudge {
  const client = config.client ?? new TypeSafeClient()
  return {
    name: 'jev',
    async judge({ session, candidates }: JudgeRequest): Promise<JudgeResult> {
      const state = toState(session)
      const questions: Record<string, ReturnType<typeof noul>> = {}
      for (const skill of candidates) questions[skill.id] = skillNoul(skill)

      const started = performance.now()
      const response = await client.systemOne({ state, questions })
      const latencyMs = Math.round(performance.now() - started)

      // Read one probability per candidate. A missing answer is a real contract
      // violation, not something to paper over — fail loud, naming the offenders.
      const answers = response.answers as Record<string, { noul?: number } | undefined>
      const probabilities = new Map<string, number>()
      const missing: string[] = []
      for (const skill of candidates) {
        const p = answers[skill.id]?.noul
        if (typeof p === 'number') probabilities.set(skill.id, p)
        else missing.push(skill.id)
      }
      if (missing.length) {
        throw new Error(`Jev returned no Noul for ${missing.length} skill(s): ${missing.join(', ')}`)
      }

      return { probabilities, latencyMs }
    }
  }
}
