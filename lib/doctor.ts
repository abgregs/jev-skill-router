import type { Skill } from './skills/types.js'
import type { UnroutableEntry } from './skills/loadSkills.js'
import type { JevJudge } from './router/judge.js'
import { route } from './router/route.js'

// The catalog doctor: is this skill catalog HEALTHY as a routing surface? The
// surface is the Agent Skills contract itself — SKILL.md frontmatter `description`,
// the field where a skill declares what it does and when it should run. That is
// all the router ever sees, so it is all the doctor grades. Every finding names
// its evidence and exactly one action — never a wall of similarity scores. Two
// layers, mirroring the repo's cost split:
//
//   static — plain code over name+description keywords: duplicates, unroutable
//            folders, weak routing surfaces, stale config entries. Always free.
//   probes — one routing run per skill, using the skill's own description as the
//            session: which OTHER skills would the router co-invoke on a task
//            squarely in this skill's territory? Overlap is thus MEASURED routing
//            confusion, not similarity. Free on the mock judge (which can only
//            see lexical confusion); semantic overlap needs the Jev judge —
//            measured on the real catalog, the known umbrella collision
//            (impeccable / web-design-guidelines / better-interface all claiming
//            holistic review) peaks at 0.39 keyword containment, indistinguishable
//            from ordinary noise, while the known rename-duplicate pair sits at
//            Jaccard 0.62 with the next pair at 0.33. Lexical catches duplicates;
//            only judgment catches umbrellas.
//
// Suites are exempt from overlap findings: same-prefix families (better-*) and
// skills whose descriptions cross-reference each other encode an author-designed
// hierarchy the router already reads correctly (see README finding) — co-firing
// inside one is the author's business, not a catalog fault.

export type FindingKind =
  | 'unroutable'
  | 'stale-config'
  | 'duplicate'
  | 'collision'
  | 'overlap'
  | 'self-miss'
  | 'weak-description'

/** Severity order for the report — broken things first, style advice last. */
export const FINDING_ORDER: FindingKind[] = [
  'unroutable',
  'stale-config',
  'duplicate',
  'collision',
  'overlap',
  'self-miss',
  'weak-description'
]

export interface Finding {
  kind: FindingKind
  /** Skill ids (or config entries) the finding is about. */
  skills: string[]
  /** One line naming the numbers/terms behind the finding. */
  evidence: string
  /** Exactly one thing to do about it. */
  action: string
}

export interface Suite {
  prefix: string
  members: string[]
}

export interface Composition {
  catalogSize: number
  excluded: string[]
  suites: Suite[]
  standalone: number
  medianKeywords: number
}

export interface DoctorConfig {
  alwaysAllow: string[]
  exclude: string[]
}

// Calibrated on the real 48-skill catalog: the known rename pair (better-ui ≡
// make-interfaces-feel-better) scores Jaccard 0.62; the next-closest pair 0.33.
const DUP_JACCARD = 0.5
// Below this many routable keywords a skill only fires on near-exact wording.
const WEAK_KEYWORDS = 8
// A same-prefix family this large is treated as an intentional suite.
const SUITE_MIN = 3

/** Jaccard similarity of two keyword sets — the static near-duplicate signal. */
export function jaccard(a: Set<string>, b: Set<string>): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a]
  let inter = 0
  for (const t of small) if (large.has(t)) inter++
  return inter / (a.size + b.size - inter)
}

const keywordSets = (skills: Skill[]) => new Map(skills.map((s) => [s.id, new Set(s.keywords)]))

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)

/** Same-prefix families of SUITE_MIN+ members (better-*, vercel-*, …). */
export function detectSuites(skills: Skill[]): Suite[] {
  const byPrefix = new Map<string, string[]>()
  for (const s of skills) {
    const dash = s.id.indexOf('-')
    if (dash <= 0) continue
    const prefix = s.id.slice(0, dash)
    byPrefix.set(prefix, [...(byPrefix.get(prefix) ?? []), s.id])
  }
  return [...byPrefix.entries()]
    .filter(([, members]) => members.length >= SUITE_MIN)
    .map(([prefix, members]) => ({ prefix, members: members.sort() }))
}

/**
 * Pairs exempt from overlap findings: members of one suite, plus any pair where
 * either description names the other skill (or its suite wildcard, "better-*") —
 * an explicit author-encoded hand-off, not an accidental collision.
 */
export function exemptPairs(skills: Skill[], suites: Suite[]): Set<string> {
  const exempt = new Set<string>()
  for (const suite of suites) {
    for (const a of suite.members) for (const b of suite.members) if (a < b) exempt.add(pairKey(a, b))
  }
  for (const a of skills) {
    const desc = a.description.toLowerCase()
    for (const b of skills) {
      if (a.id === b.id) continue
      const dash = b.id.indexOf('-')
      const wildcard = dash > 0 ? `${b.id.slice(0, dash)}-*` : null
      if (desc.includes(b.id) || (wildcard && desc.includes(wildcard))) exempt.add(pairKey(a.id, b.id))
    }
  }
  return exempt
}

export function composition(skills: Skill[], excluded: string[]): Composition {
  const suites = detectSuites(skills)
  const inSuite = new Set(suites.flatMap((s) => s.members))
  const counts = skills.map((s) => s.keywords.length).sort((a, b) => a - b)
  return {
    catalogSize: skills.length,
    excluded,
    suites,
    standalone: skills.length - inSuite.size,
    medianKeywords: counts[Math.floor(counts.length / 2)] ?? 0
  }
}

/**
 * Free, static findings: unroutable folders, stale config, duplicates, weak surfaces.
 * `skills` is the catalog under analysis; `routable` is every id the router can judge
 * (all hook layers, excluded skills included) — a config entry naming one is live.
 */
export function staticFindings(
  skills: Skill[],
  unroutable: UnroutableEntry[],
  config: DoctorConfig,
  routable: Iterable<string> = []
): { findings: Finding[]; duplicatePairs: Set<string> } {
  const findings: Finding[] = []

  for (const u of unroutable) {
    findings.push({
      kind: 'unroutable',
      skills: [u.id],
      evidence:
        u.reason === 'no-skill-md'
          ? `${u.source} has no SKILL.md`
          : `${u.source} has no description in its frontmatter`,
      action:
        u.reason === 'no-skill-md'
          ? 'add a SKILL.md with a description, or remove the folder if it is not a skill'
          : 'add a description — the router skips skills without one (Claude Code falls back to the first line of the body)'
    })
  }

  const known = new Set([...skills.map((s) => s.id), ...routable, ...unroutable.map((u) => u.id)])
  for (const [key, entries] of [
    ['alwaysAllow', config.alwaysAllow],
    ['exclude', config.exclude]
  ] as const) {
    for (const entry of entries) {
      if (known.has(entry)) continue
      findings.push({
        kind: 'stale-config',
        skills: [entry],
        evidence: `"${entry}" in ${key} matches no installed skill`,
        action: 'fix or remove the entry in .skillrouter.json'
      })
    }
  }

  const sets = keywordSets(skills)
  const duplicatePairs = new Set<string>()
  for (let i = 0; i < skills.length; i++) {
    for (let j = i + 1; j < skills.length; j++) {
      const a = skills[i] as Skill
      const b = skills[j] as Skill
      const jac = jaccard(sets.get(a.id) as Set<string>, sets.get(b.id) as Set<string>)
      if (jac < DUP_JACCARD) continue
      duplicatePairs.add(pairKey(a.id, b.id))
      // Suggest dropping the thinner routing surface; the user can invert the pick.
      const [keep, drop] = a.keywords.length >= b.keywords.length ? [a, b] : [b, a]
      findings.push({
        kind: 'duplicate',
        skills: [a.id, b.id],
        evidence: `near-verbatim descriptions — keyword Jaccard ${jac.toFixed(2)} (likely a rename of the same skill)`,
        action:
          `uninstall ${drop.id} (or add it to "exclude") — ${keep.id} carries the richer routing ` +
          `surface (${keep.keywords.length} vs ${drop.keywords.length} keywords); until then every ` +
          `task on this territory splits between them`
      })
    }
  }

  for (const s of skills) {
    if (s.keywords.length >= WEAK_KEYWORDS) continue
    findings.push({
      kind: 'weak-description',
      skills: [s.id],
      evidence: `description yields only ${s.keywords.length} routable keyword(s) — fires only on near-exact wording`,
      action: 'expand the description with concrete trigger phrases ("Use when …", the terms users actually type)'
    })
  }

  return { findings, duplicatePairs }
}

// ---- Probe layer --------------------------------------------------------------------

export interface ProbeOutcome {
  skillId: string
  /**
   * skill id → p(invoke) for every catalog skill judged in this probe. Raw judgment,
   * no threshold applied — so a recorded run can be re-interpreted at any threshold
   * without re-judging (policy is plain code).
   */
  probabilities: Record<string, number>
}

export interface ProbeOptions {
  shardSize?: number
  /** Concurrent probes (each probe judges the whole catalog, sharded). */
  concurrency?: number
}

/**
 * The probe session for one skill: a task squarely in its territory. Task-framed
 * rather than the raw description — a bare description reads as meta-text about a
 * skill, and the real judge (correctly) scores "that's not a task" low across the
 * board, poisoning the instrument. Measured on the first real-Jev doctor run.
 */
export function probeSession(skill: Skill): { latestQuery: string; transcript: string } {
  return {
    latestQuery: `My current task is squarely the kind of work this covers: ${skill.description}`,
    transcript: ''
  }
}

/**
 * Route a probe session per skill in `probeSkills` against the whole catalog.
 * Co-invocation on a skill's home territory is the doctor's definition of overlap:
 * not "these look similar" but "the router as configured would load both".
 */
export async function runProbes(
  probeSkills: Skill[],
  skills: Skill[],
  judge: JevJudge,
  opts: ProbeOptions = {}
): Promise<ProbeOutcome[]> {
  const concurrency = opts.concurrency ?? 8
  const outcomes: ProbeOutcome[] = []
  for (let i = 0; i < probeSkills.length; i += concurrency) {
    const batch = probeSkills.slice(i, i + concurrency)
    outcomes.push(
      ...(await Promise.all(
        batch.map(async (skill) => {
          // Policy output (selected/suggested) is ignored: the doctor keeps raw
          // probabilities and interprets them itself, so recordings stay threshold-free.
          const result = await route(probeSession(skill), skills, judge, {
            shardSize: opts.shardSize
          })
          const probabilities: Record<string, number> = {}
          for (const s of result.scored) {
            if (s.judged && s.probability !== null) probabilities[s.skill.id] = s.probability
          }
          return { skillId: skill.id, probabilities }
        })
      ))
    )
  }
  return outcomes
}

export interface ProbeAnalysis {
  findings: Finding[]
  /** Probes whose own skill didn't fire — bad instruments, no conclusions drawn. */
  inconclusive: string[]
}

/**
 * Turn probe outcomes into findings:
 *   collision — skills that co-invoke on EACH OTHER's territory (mutual): same job,
 *               claimed by different authors. Only the user's preference resolves it.
 *   overlap   — one-way: an intruder fires on a specialist's territory while the
 *               specialist stays scoped. The intruder needs a "not for …" clause.
 *   self-miss — the router won't invoke a skill even on a task built from its own
 *               description; that probe is also an unusable instrument, so NO
 *               overlap conclusions are drawn from it (gating, not punishment).
 * Suite/cross-referenced pairs, static duplicates, and alwaysAllow process skills
 * (deliberately ride-along) are exempt.
 */
export function probeFindings(
  outcomes: ProbeOutcome[],
  exempt: Set<string>,
  duplicatePairs: Set<string>,
  config: DoctorConfig,
  threshold: number
): ProbeAnalysis {
  const findings: Finding[] = []
  const alwaysAllow = new Set(config.alwaysAllow)

  // Interpretation of raw probe probabilities at `threshold` — all policy, no judge.
  const selfP = (o: ProbeOutcome): number | null => o.probabilities[o.skillId] ?? null
  const coInvoked = (o: ProbeOutcome): { id: string; p: number }[] =>
    Object.entries(o.probabilities)
      .filter(([id, p]) => id !== o.skillId && p >= threshold)
      .map(([id, p]) => ({ id, p }))
      .sort((a, b) => b.p - a.p)

  const conclusive = new Set<string>()
  const inconclusive: string[] = []
  const selfMisses: { id: string; p: number | null }[] = []
  const edges = new Map<string, number>() // "a>b" — b fired at p on a's territory
  for (const o of outcomes) {
    const self = selfP(o)
    if (self === null || self < threshold) {
      inconclusive.push(o.skillId)
      selfMisses.push({ id: o.skillId, p: self })
      continue // an instrument its own skill rejects proves nothing about others
    }
    conclusive.add(o.skillId)
    for (const co of coInvoked(o)) {
      const key = pairKey(o.skillId, co.id)
      if (exempt.has(key) || duplicatePairs.has(key)) continue
      edges.set(`${o.skillId}>${co.id}`, co.p)
    }
  }

  // One grouped finding: the action is identical for every self-miss, and a report
  // with ten copies of it stops being short.
  if (selfMisses.length > 0) {
    findings.push({
      kind: 'self-miss',
      skills: selfMisses.map((s) => s.id),
      evidence:
        `on tasks built from their own descriptions the router scores them under t=${threshold}: ` +
        selfMisses.map((s) => `${s.id} (${s.p === null ? 'not judged' : s.p.toFixed(2)})`).join(', ') +
        ` — the descriptions may not read as invokable triggers`,
      action:
        'rewrite these descriptions to say when to USE the skill, then re-run the doctor ' +
        '(--only <ids>) — these probes drew no other conclusions'
    })
  }

  // Mutual edges → union-find collision clusters; leftover one-ways group by intruder.
  const parent = new Map<string, string>()
  const find = (x: string): string => {
    const p = parent.get(x)
    if (p === undefined || p === x) return x
    const r = find(p)
    parent.set(x, r)
    return r
  }
  const union = (a: string, b: string) => {
    const [ra, rb] = [find(a), find(b)]
    if (ra !== rb) parent.set(ra, rb)
  }

  const mutual: [string, string][] = []
  for (const key of edges.keys()) {
    const [a, b] = key.split('>') as [string, string]
    if (a < b && edges.has(`${b}>${a}`)) {
      mutual.push([a, b])
      union(a, b)
    }
  }

  const clusters = new Map<string, Set<string>>()
  for (const [a, b] of mutual) {
    const root = find(a)
    const cluster = clusters.get(root) ?? new Set<string>()
    cluster.add(a).add(b)
    clusters.set(root, cluster)
  }

  const inCollision = new Set<string>()
  for (const cluster of clusters.values()) {
    const members = [...cluster].sort()
    for (const m of members) inCollision.add(m)
    // Evidence: the single probe that co-invoked the most of this cluster.
    const best = outcomes
      .filter((o) => cluster.has(o.skillId))
      .map((o) => ({ o, hits: coInvoked(o).filter((c) => cluster.has(c.id)) }))
      .sort((x, y) => y.hits.length - x.hits.length)[0]
    const shown = best
      ? `on a task squarely in ${best.o.skillId}'s territory the router co-invokes ` +
        best.hits.map((h) => `${h.id} (${h.p.toFixed(2)})`).join(', ') +
        ` at t=${threshold} — and the reverse probes agree`
      : `members co-invoke on each other's territory at t=${threshold}`
    findings.push({
      kind: 'collision',
      skills: members,
      evidence: shown,
      action: 'these claim the same job — keep your favorite and add the others to "exclude" in .skillrouter.json'
    })
  }

  // One-way intrusions, grouped by intruder. alwaysAllow skills are exempt as
  // intruders: the user already decided they ride along on every relevant turn.
  const intrusions = new Map<string, { territory: string; p: number }[]>()
  for (const [key, p] of edges) {
    const [territory, intruder] = key.split('>') as [string, string]
    if (edges.has(`${intruder}>${territory}`)) continue // mutual — already a collision
    if (inCollision.has(intruder) && inCollision.has(territory)) continue
    if (alwaysAllow.has(intruder)) continue
    intrusions.set(intruder, [...(intrusions.get(intruder) ?? []), { territory, p }])
  }

  const probed = new Set(outcomes.map((o) => o.skillId))
  for (const [intruder, hits] of [...intrusions.entries()].sort((a, b) => b[1].length - a[1].length)) {
    hits.sort((a, b) => b.p - a.p)
    const named = hits.map((h) => `${h.territory} (${h.p.toFixed(2)})`).join(', ')
    // The reverse direction is only a measured fact if the intruder's own probe ran
    // conclusively; otherwise say what is unknown instead of claiming scoped-ness.
    const reverse = conclusive.has(intruder)
      ? `on ${intruder}'s own territory they stay silent — it intrudes, they stay scoped`
      : probed.has(intruder)
        ? `(${intruder}'s own probe was inconclusive, so the reverse direction is unmeasured)`
        : `(${intruder}'s territory was not probed in this run, so the reverse direction is unmeasured)`
    findings.push({
      kind: 'overlap',
      skills: [intruder, ...hits.map((h) => h.territory)],
      evidence: `${intruder} fires on the home territory of ${named}; ${reverse}`,
      action:
        `add a clause like "Not for ${hits.map((h) => h.territory).slice(0, 3).join(' / ')}-style work — ` +
        `defer to those skills" to ${intruder}'s description`
    })
  }

  return { findings, inconclusive }
}

/** Sort findings into severity order for the report. */
export function orderFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => FINDING_ORDER.indexOf(a.kind) - FINDING_ORDER.indexOf(b.kind))
}

// ---- Recordings ---------------------------------------------------------------------
// Paid probe sweeps are captured so the doctor can be re-run — different threshold,
// different interpretation code — without re-judging. Probabilities are raw (no
// threshold baked in); each outcome snapshots the descriptions of every candidate it
// judged, because a probe is only valid for the descriptions Jev actually read.
// Snapshots are per-outcome (not one shared catalog map) so an --only re-probe can
// merge into the file without masking staleness of outcomes it didn't refresh.

export interface RecordedProbe extends ProbeOutcome {
  /** id → description of every skill judged in this probe, at capture time. */
  descriptions: Record<string, string>
}

export interface DoctorRecording {
  kind: 'doctor-probes'
  capturedAt: string
  skillsDir: string
  judge: string
  outcomes: RecordedProbe[]
}

export function toRecordedProbes(outcomes: ProbeOutcome[], skills: Skill[]): RecordedProbe[] {
  const byId = new Map(skills.map((s) => [s.id, s]))
  return outcomes.map((o) => {
    const descriptions: Record<string, string> = {}
    for (const id of new Set([o.skillId, ...Object.keys(o.probabilities)])) {
      const skill = byId.get(id)
      if (skill) descriptions[id] = skill.description
    }
    return { ...o, descriptions }
  })
}

/** Merge fresh probes into an existing recording: replace by probed skill id. */
export function mergeRecordedProbes(existing: RecordedProbe[], fresh: RecordedProbe[]): RecordedProbe[] {
  const freshIds = new Set(fresh.map((o) => o.skillId))
  return [...existing.filter((o) => !freshIds.has(o.skillId)), ...fresh]
}

/**
 * Outcomes whose captured world no longer matches the catalog: any judged
 * candidate's description changed, or the probed skill is gone. Their
 * probabilities answer a question nobody is asking anymore.
 */
export function staleRecordedProbes(
  outcomes: RecordedProbe[],
  skills: Skill[]
): { stale: string[]; removed: string[] } {
  const byId = new Map(skills.map((s) => [s.id, s]))
  const stale: string[] = []
  const removed: string[] = []
  for (const o of outcomes) {
    if (!byId.has(o.skillId)) {
      removed.push(o.skillId)
      continue
    }
    const changed = Object.entries(o.descriptions).some(([id, desc]) => {
      const now = byId.get(id)
      return now !== undefined && now.description !== desc
    })
    if (changed) stale.push(o.skillId)
  }
  return { stale, removed }
}
