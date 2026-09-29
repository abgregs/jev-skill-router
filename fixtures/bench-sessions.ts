import { SESSIONS } from './sessions.js'

// Prompts for the A/B SESSION benchmark (scripts/session-bench.ts): each is submitted
// verbatim to a real headless Claude Code session in both arms (router hooks on / off).
//
// Ground-truth rules, per the repo's eval standard:
//   • `expected` is curated BEFORE any benchmark run — never read off an arm's output,
//     and never taken from the router's own verdict (that would be self-fulfilling).
//   • `acceptable` marks plausible companions that count as neither hits nor junk —
//     for prompts whose full skill set is genuinely fuzzy, the required core stays strict.
//   • A negative control's only correct outcome is invoking NO skills.

export interface BenchFixture {
  id: string
  prompt: string
  /** Skills the session SHOULD invoke — the required core, curated up front. */
  expected: string[]
  /** Neither hits nor junk: plausible companions we decline to punish or require. */
  acceptable: string[]
  /** True when the correct outcome is invoking no skills at all. */
  negativeControl: boolean
}

/** Reuse a labeled real-catalog fixture's query + curated truth from fixtures/sessions.ts. */
function fromSession(id: string, acceptable: string[] = []): BenchFixture {
  const s = SESSIONS.find((x) => x.id === id)
  if (!s) throw new Error(`No labeled session fixture: ${id}`)
  if (!(s.targets ?? ['synthetic']).includes('real'))
    throw new Error(`Fixture ${id} does not target the real catalog — its truth is meaningless here.`)
  return { id, prompt: s.session.latestQuery, expected: s.expected, acceptable, negativeControl: false }
}

export const BENCH_FIXTURES: BenchFixture[] = [
  // Two-skill truth spanning a whole workflow (commit, then PR).
  fromSession('commit-and-pr'),
  // Build-verb probe beside auditor/reviewer traps; the traps stay traps (no acceptable list).
  fromSession('build-animation'),
  // Fix task; web-design-guidelines is the trap. diagnosing-bugs ("reports something
  // broken") is a defensible companion for a bug report, not junk.
  fromSession('a11y-widget', ['diagnosing-bugs']),
  // Unique-match probe: the only Swift skill in the catalog.
  fromSession('swift-concurrency'),
  {
    // The prompt from the real design session that motivated this benchmark. Its full
    // skill set is fuzzy, so the required core is strict (impeccable owns "design the
    // visual direction") and the design suite counts as acceptable, not required.
    id: 'design-doc-direction',
    prompt:
      'design the visual direction for the jev-skill-router recorded demo — philosophy, ' +
      'color tokens, type, motion principles — and write it to a design doc before any UI code',
    expected: ['impeccable'],
    acceptable: ['better-colors', 'better-typography', 'apple-design', 'emil-design-eng', 'better-ui'],
    negativeControl: false
  },
  {
    // Negative control: purely conversational — does the no-hook arm invoke junk,
    // and does the hook arm stay silent?
    id: 'no-skill-chat',
    prompt:
      'quick question while I have you — what does "idempotent" mean for HTTP methods, ' +
      'and why does it matter for retries? just explain, no code changes needed',
    expected: [],
    acceptable: [],
    negativeControl: true
  }
]
