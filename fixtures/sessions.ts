import type { SessionState } from '../lib/skills/types.js'

// Labeled coding-agent sessions with ground-truth skills the router SHOULD select.
// Each fixture targets the catalog its `expected` ids belong to: the synthetic org
// catalog (e.g. `rollback-release-payments`) or the user's real installed skills
// (e.g. `migrate-radix-to-base`). The traps are deliberate: the correct answer
// always sits beside a wrong-service twin (`*-maps`), a wrong-verb sibling
// (`rollback-migration` vs `rollback-release-*`), or a real near-twin
// (`deploy-to-vercel` vs `vercel-cli-with-tokens`) so the metrics mean something.
//
// Running a fixture against a catalog it does NOT target is still useful — as a
// NEGATIVE CONTROL: none of its expected ids exist there, so the only correct
// routing outcome is selecting nothing. Evals must report those runs as abstention
// checks, never as P/R/F1 (which is structurally zero by construction).

export interface LabeledSession {
  id: string
  session: SessionState
  expected: string[]
  /**
   * Catalogs whose skills this fixture's `expected` ids name — where vs-truth
   * metrics are meaningful. Absent = ['synthetic'] (the original org fixtures).
   */
  targets?: ('real' | 'synthetic')[]
}

/** True when vs-truth metrics are meaningful for this fixture × catalog pair. */
export function fixtureTargets(fixture: LabeledSession, catalog: 'real' | 'synthetic'): boolean {
  return (fixture.targets ?? ['synthetic']).includes(catalog)
}

const SWIFT_PLAN =
  'User: the ios app hangs when the sync task and the ui both touch the cache. can you figure out what to do?\n' +
  'Assistant: The hang is a data race: the sync task mutates the cache off the main actor while the view reads it. ' +
  'The fix is to make the cache an actor, mark the view model @MainActor, and move the sync work into a task group so ' +
  'the writes are serialized. That touches CacheStore.swift and SyncCoordinator.swift. Shall I make those changes?'

export const SESSIONS: LabeledSession[] = [
  {
    id: 'payments-rollback',
    session: {
      latestQuery:
        'the payments service is throwing 500s at checkout right after the last release — ' +
        'roll it back to the previous version and pull up the datadog dashboard for the error rate',
      transcript: 'User: on-call for payments tonight. Assistant: watching the payments error budget.',
    },
    // NOT rollback-migration (wrong verb) and NOT rollback-release-maps (wrong service).
    // "Pull up the dashboard" means view an existing one; create-datadog-dashboard
    // builds one and the catalog has no view skill, so it is a wrong-verb trap, not
    // truth. Label corrected 2026-09-29, after capture; the recording keeps its
    // capture-time copy.
    expected: ['rollback-release-payments']
  },
  {
    id: 'maps-latency',
    session: {
      latestQuery:
        'eta lookups in the maps service got slow this afternoon — trace the latency regression ' +
        'with distributed traces and add an slo alert so we page next time',
      transcript: 'User: maps p99 climbed after lunch.',
    },
    expected: ['trace-latency-regression-maps', 'add-slo-alert-maps']
  },
  {
    id: 'driver-grpc',
    session: {
      latestQuery:
        'add a new grpc endpoint to the driver service and regenerate the protobuf stubs from the updated proto',
      transcript: 'User: extending the driver API for the new dispatch flow.',
    },
    // Per-service endpoint work PLUS the org-wide protobuf skill.
    expected: ['add-grpc-endpoint-driver', 'generate-protobuf']
  },
  {
    id: 'fraud-security',
    session: {
      latestQuery:
        'rotate the api keys and credentials for the fraud service and run a dependency and container ' +
        'security scan before the audit on friday',
      transcript: 'User: security audit prep for fraud.'
    },
    expected: ['rotate-secrets-fraud', 'run-security-scan-fraud']
  },
  {
    id: 'wallet-incident',
    session: {
      latestQuery:
        'prod is down for the wallet service — open a production incident and coordinate the bridge, ' +
        'and once we mitigate write the blameless postmortem',
      transcript: 'User: wallet fully down, customers cannot pay.'
    },
    // Org-wide process skills, not a per-service capability. The incident is live, and
    // write-postmortem's own description sends live incidents to open-incident, so the
    // postmortem is a later-phase trap, not truth this turn. Label corrected 2026-09-29,
    // after capture; the recording keeps its capture-time copy.
    expected: ['open-incident']
  },

  // ---- Real-catalog fixtures: queries with highly targeted matches among the
  // ---- user's actually-installed skills, so vs-truth metrics are validated
  // ---- against curated REAL ground truth (not borrowed synthetic labels).
  {
    id: 'radix-migration',
    session: {
      latestQuery:
        'our react components still use radix ui primitives — migrate the dialog and dropdown-menu over to base ui',
      transcript: 'User: moving the design system off radix this sprint.',
    },
    // Uniquely migrate-radix-to-base; nothing else in the catalog does migration.
    expected: ['migrate-radix-to-base'],
    targets: ['real']
  },
  {
    id: 'vercel-token-deploy',
    session: {
      latestQuery:
        'set up the vercel cli with our team access token in the ci workflow and deploy from there — no interactive login available',
      transcript: 'User: wiring up the release pipeline in github actions.',
    },
    // The token/non-interactive constraint picks vercel-cli-with-tokens over its
    // near-twin deploy-to-vercel (interactive login) — the real-catalog twin trap.
    expected: ['vercel-cli-with-tokens'],
    targets: ['real']
  },
  {
    id: 'commit-and-pr',
    session: {
      latestQuery:
        'commit the staged retry-logic changes with a proper conventional message, then push the branch and open a pr for review',
      transcript: 'User: wrapped up the retry backoff changes, tests green.',
    },
    // Two-skill ground truth spanning the whole workflow.
    expected: ['git-commit', 'git-create-pr'],
    targets: ['real']
  },
  {
    id: 'swift-concurrency',
    session: {
      latestQuery:
        'migrate this module to swift 6 strict concurrency — fix the sendable warnings and decide what should be main-actor isolated versus moved onto an actor',
      transcript: 'User: modernizing the ios app for swift 6.',
    },
    // The only Swift skill in the catalog — a unique-match probe.
    expected: ['write-swift'],
    targets: ['real']
  },
  {
    id: 'animation-naming',
    session: {
      latestQuery:
        'there is a name for that effect where a popover scales in with a slight overshoot and settles — what is it called? i need the exact term to search the docs',
      transcript: 'User: speccing motion for the new dropdown.'
    },
    // Wrong-verb traps inside the animation family: animate (build it),
    // improve/review-animations (audit it), apple-design (philosophy).
    expected: ['animation-vocabulary'],
    targets: ['real']
  },
  {
    id: 'build-animation',
    session: {
      latestQuery:
        'the notification toast just pops into existence — build a proper enter and exit animation for it and pick the right curve and duration',
      transcript: 'User: polishing the toast component today.',
    },
    // The build-verb counterpart of animation-naming; auditors/reviewers are traps.
    expected: ['animate'],
    targets: ['real']
  },
  {
    id: 'a11y-widget',
    session: {
      latestQuery:
        'our custom combobox is broken for keyboard users and voiceover announces nothing — fix the focus management and aria wiring',
      transcript: 'User: got an accessibility bug report from a customer.',
    },
    // Fix task, not a review — web-design-guidelines ("check accessibility") is the trap.
    expected: ['better-accessibility'],
    targets: ['real']
  },
  {
    id: 'prop-refactor',
    session: {
      latestQuery:
        'the Button component has grown a dozen boolean props — refactor it into a composable compound-component api instead',
      transcript: 'User: cleaning up the design system components.',
    },
    // codebase-design (module interfaces) and react-best-practices are close siblings.
    expected: ['vercel-composition-patterns'],
    targets: ['real']
  },
  {
    id: 'mobile-list-perf',
    session: {
      latestQuery:
        'the feed flatlist in our expo app drops frames on scroll — optimize the list rendering and memoization',
      transcript: 'User: react native perf pass before the release.',
    },
    // Near-twin trap: vercel-react-best-practices is the WEB react perf skill;
    // diagnosing-bugs ("slow") is the wrong-verb trap for a prescriptive optimize ask.
    expected: ['vercel-react-native-skills'],
    targets: ['real']
  },
  {
    id: 'prd-from-convo',
    session: {
      latestQuery:
        'good discussion — turn this conversation into a prd and publish it to the issue tracker',
      transcript: 'User: we just scoped the notifications revamp.'
    },
    // handoff is the near-twin (also conversation → document, different purpose).
    // Retired from live runs 2026-10-07: `to-prd` sets disable-model-invocation, so the
    // loader never routes it and no run can hit. The entry stays for the recorded
    // user-only exhibit (eval:report and the demo read its truth by id). With no targets,
    // live probes skip it and eval:capture records it as a negative control. ste-rewrite
    // below is its replacement as a hit fixture.
    expected: ['to-prd'],
    targets: []
  },
  {
    id: 'ste-rewrite',
    session: {
      latestQuery:
        "the pump maintenance procedure in the field manual reads like engineering notes — rewrite it in " +
        'simplified technical english so the technicians can follow it',
      transcript: 'User: the field manual is going out to the service team next week.'
    },
    // better-writing (interface copy) and writing-for-agents (docs for agents) are the twins.
    expected: ['simplified-technical-english'],
    targets: ['real']
  },
  {
    id: 'contrast-audit',
    session: {
      latestQuery:
        'audit the dashboard palette for wcag contrast in dark mode and fix the failing color tokens',
      transcript: 'User: dark mode ships next week.',
    },
    // Compound query, two-skill truth — probes whether the secondary intent lands
    // in the 0.85–0.90 band on real skills like it did on synthetic ones.
    // better-accessibility is the weaker label: better-colors triggers on contrast
    // ratio too. Kept as pre-registered so bench numbers stay comparable.
    expected: ['better-colors', 'better-accessibility'],
    targets: ['real']
  },
  {
    id: 'holistic-review',
    session: {
      latestQuery:
        'give the signup screen a holistic review across the board — layout, copy, colors, type, accessibility — and hand me one ranked list of what to fix',
      transcript: 'User: last design pass before launch.',
    },
    // The suite-hierarchy probe: better-interface describes itself as the orchestrator
    // over the better-* leaves ("holistic review rather than a single domain"). Do the
    // leaves stand down here the way the orchestrator stood down on build-animation?
    expected: ['better-interface'],
    targets: ['real']
  },
  // ---- continuation turns: the plan lives in the transcript, the prompt is only a
  // go-ahead. Added 2026-10-07 after live probes showed the current-request framing
  // from finding 0004 routed nothing on these. The last fixture is the control: a
  // topic switch away from the plan must still route on the prompt alone.
  {
    id: 'go-commit-pr',
    session: {
      latestQuery: 'yes go ahead',
      transcript:
        "User: I've finished the retry backoff changes and tests are green. What's left before this is reviewable?\n" +
        'Assistant: Two steps remain. First, commit the staged retry-logic changes with a conventional message that ' +
        'explains the backoff cap. Second, push the branch and open a pull request against main with a summary of the ' +
        'change and the test evidence. Want me to proceed?'
    },
    expected: ['git-commit', 'git-create-pr'],
    targets: ['real']
  },
  {
    id: 'go-swift',
    session: { latestQuery: 'proceed', transcript: SWIFT_PLAN },
    expected: ['write-swift'],
    targets: ['real']
  },
  {
    id: 'go-radix',
    session: {
      latestQuery: 'do it',
      transcript:
        "User: we're moving the design system off radix this sprint. where should we start?\n" +
        "Assistant: Start with the two primitives the most screens share: Dialog and DropdownMenu. I'd port each to the " +
        'Base UI equivalent, keep the existing props surface, and run the component tests after each one. Ready when you are.'
    },
    expected: ['migrate-radix-to-base'],
    targets: ['real']
  },
  {
    id: 'switch-after-plan',
    session: {
      latestQuery:
        'commit the staged retry-logic changes with a proper conventional message, then push the branch and open a pr for review',
      transcript: SWIFT_PLAN
    },
    // write-swift is the trap: the plan in the transcript is Swift work the user walked away from.
    expected: ['git-commit', 'git-create-pr'],
    targets: ['real']
  }
]

// Ground-truth additions, display layer and reports only — SESSIONS
// stays pre-registered for the bench. Each entry is decided per fixture from the query
// and the skill's description, never from the run: truth is the skill each part
// of the ask can't do without, so skills that fit but aren't needed stay unmarked.
// maps-latency asks to look into a latency regression and diagnosing-bugs, which
// names performance-regression diagnosis as a use case, is the only real skill
// that covers it.
export const FIXTURE_TRUTH_EXTRA: Record<string, string[]> = {
  'maps-latency': ['diagnosing-bugs']
}
