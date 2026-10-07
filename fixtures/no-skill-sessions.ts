import type { SessionState } from '../lib/skills/types.js'

// Prompts that need NO skill from the real 51-skill catalog: the needless-load set.
// A needless load is any skill invoked on one of these (p >= threshold). The task
// fixtures in sessions.ts only measure hits; this set measures the other side.
//
// Labeling rule: a prompt belongs here only if no skill's description names the work
// it asks for, as a use case or a trigger topic, AND the model can do the whole ask
// without a skill. Prompts a description claims outright are left out even when a
// skill feels unnecessary (e.g. "add a line to CLAUDE.md" — writing-for-agents names
// CLAUDE.md edits). `traps` are the skills nearest to firing, chosen from descriptions alone;
// they are for reading results, not graded.
//
// Transcripts use the hook's format ("User: …" / "Assistant: …" lines, oldest
// first), because the plugin sends the conversation tail with every prompt and most
// real no-skill turns are follow-ups.

export type NoSkillCategory =
  | 'acknowledgement' // control turns: thanks, go ahead, stop, undo
  | 'knowledge' // conceptual questions the model answers from what it knows
  | 'codebase' // questions about this repo's code
  | 'small-edit' // mechanical edits with the value given
  | 'routine' // everyday commands: run tests, git log, install
  | 'carryover' // a skill-heavy previous turn, then a request that needs none

export interface NoSkillSession {
  id: string
  category: NoSkillCategory
  session: SessionState
  /** Skills nearest to firing by description. For reading results only. */
  traps: string[]
}

const COMMIT_DONE =
  'User: commit the retry backoff changes with a conventional message\n' +
  'Assistant: Committed as `fix(retry): cap exponential backoff at 30s` — 3 files, ' +
  '`lib/retry.ts`, `lib/retry.test.ts`, `docs/retry.md`. Tests pass. Working tree is clean.'

export const NO_SKILL_SESSIONS: NoSkillSession[] = [
  // ---- acknowledgement
  {
    id: 'ack-thanks',
    category: 'acknowledgement',
    session: { latestQuery: 'perfect, thanks', transcript: COMMIT_DONE },
    traps: ['git-commit']
  },
  {
    id: 'ack-go-small-edit',
    category: 'acknowledgement',
    session: {
      latestQuery: 'ok',
      transcript:
        "User: there's a typo in the README heading and the variable name in main.ts is misleading.\n" +
        "Assistant: I'll fix the heading and rename the variable to activeSessionCount. OK?"
    },
    traps: ['better-writing', 'brief']
  },
  {
    id: 'ack-pick-option',
    category: 'acknowledgement',
    session: {
      latestQuery: 'go with option 2',
      transcript:
        'User: the session-expiry test is flaky in ci, can you look\n' +
        'Assistant: It compares `Date.now()` against a 50ms window, so a slow runner ' +
        'misses it. Options: 1) widen the window to 500ms, 2) fake the clock with ' +
        '`vi.useFakeTimers()` and advance it explicitly, 3) drop the timing assertion. ' +
        'Option 2 is the most robust. Which do you want?'
    },
    traps: ['tdd', 'diagnosing-bugs']
  },
  {
    id: 'ack-hold-push',
    category: 'acknowledgement',
    session: {
      latestQuery: "hold on, don't push yet — i want to squash those two commits first, i'll do it myself",
      transcript:
        COMMIT_DONE +
        '\nUser: also commit the docs tweak separately\n' +
        'Assistant: Committed as `docs(retry): note the 30s cap`. Ready to push and open a PR.'
    },
    traps: ['git-create-pr', 'git-commit']
  },
  {
    id: 'ack-undo',
    category: 'acknowledgement',
    session: {
      latestQuery: 'undo that last change, i liked it better before',
      transcript:
        'User: the accent feels too saturated\n' +
        'Assistant: Changed `--accent` in `app/globals.css` from `oklch(0.62 0.21 264)` to ' +
        '`oklch(0.62 0.15 264)`, lowering chroma and keeping lightness the same.'
    },
    traps: ['better-colors']
  },
  {
    id: 'ack-status',
    category: 'acknowledgement',
    session: {
      latestQuery: "where are we at? what's left?",
      transcript:
        'User: rename the `Shard` type to `Batch` across the router and update the docs\n' +
        'Assistant: Renamed in `lib/router/route.ts` and `lib/router/judge.ts`. Updating ' +
        '`docs/architecture/how-routing-works.md` next, then the README mentions.'
    },
    traps: []
  },

  // ---- knowledge
  {
    id: 'q-rebase-vs-merge',
    category: 'knowledge',
    session: {
      latestQuery: "what's the actual difference between git rebase and git merge, and when would i pick one over the other?",
      transcript: ''
    },
    traps: ['git-commit', 'git-create-pr']
  },
  {
    id: 'q-400-vs-422',
    category: 'knowledge',
    session: {
      latestQuery: 'should a request that fails validation return 400 or 422?',
      transcript: ''
    },
    traps: []
  },
  // ---- codebase
  {
    id: 'cb-where-shard-size',
    category: 'codebase',
    session: {
      latestQuery: 'where do we set the shard size?',
      transcript: ''
    },
    traps: []
  },
  {
    id: 'cb-policy-tie',
    category: 'codebase',
    session: {
      latestQuery: 'what does applyPolicy do when more than six skills clear the threshold?',
      transcript: ''
    },
    traps: ['model-routing']
  },
  {
    id: 'cb-who-imports',
    category: 'codebase',
    session: {
      latestQuery: 'which files import loadSkills?',
      transcript: ''
    },
    traps: []
  },

  // ---- small-edit
  {
    id: 'edit-missing-await',
    category: 'small-edit',
    session: {
      latestQuery: 'the route test fails because i forgot an await on line 42 of route.test.ts, add it',
      transcript: ''
    },
    // "fails" is a diagnosing-bugs trigger, but the cause is already known.
    traps: ['diagnosing-bugs', 'tdd']
  },
  {
    id: 'edit-rename-fn',
    category: 'small-edit',
    session: {
      latestQuery: 'rename fetchUser to loadUser everywhere',
      transcript: ''
    },
    traps: ['codebase-design']
  },
  {
    id: 'edit-typo',
    category: 'small-edit',
    session: {
      latestQuery: "fix the typo in the README, 'recieve' should be 'receive'",
      transcript: ''
    },
    traps: ['better-writing']
  },
  {
    id: 'edit-gitignore',
    category: 'small-edit',
    session: {
      latestQuery: 'add .env.local to .gitignore',
      transcript: ''
    },
    traps: ['git-commit']
  },
  {
    id: 'edit-bump-dep',
    category: 'small-edit',
    session: {
      latestQuery: 'bump typescript to 5.8 in package.json and reinstall',
      transcript: ''
    },
    traps: []
  },

  // ---- routine
  {
    id: 'run-tests',
    category: 'routine',
    session: {
      latestQuery: 'run the test suite',
      transcript: ''
    },
    traps: ['tdd']
  },
  {
    id: 'run-git-status',
    category: 'routine',
    session: {
      latestQuery: "what's uncommitted right now?",
      transcript: ''
    },
    traps: ['git-commit']
  },
  {
    id: 'run-git-log',
    category: 'routine',
    session: {
      latestQuery: 'show me the last 5 commits on main',
      transcript: ''
    },
    traps: ['git-commit']
  },
  {
    id: 'run-install',
    category: 'routine',
    session: {
      latestQuery: 'npm install zod',
      transcript: ''
    },
    traps: []
  },
  {
    id: 'run-dev-server',
    category: 'routine',
    session: {
      latestQuery: 'start the dev server',
      transcript: ''
    },
    traps: []
  },
  {
    id: 'run-pr-comments',
    category: 'routine',
    session: {
      latestQuery: 'what did the reviewer say on pr 42?',
      transcript: ''
    },
    // Reading review comments, not opening or updating the PR.
    traps: ['git-create-pr', 'hunk-review']
  },
  {
    id: 'run-switch-model',
    category: 'routine',
    session: {
      latestQuery: 'switch to sonnet for the rest of this session',
      transcript: ''
    },
    // The choice is already made; model-routing is for making it.
    traps: ['model-routing']
  },

  // ---- carryover
  {
    id: 'co-commit-then-jest',
    category: 'carryover',
    session: {
      latestQuery: 'unrelated, but how do i make jest show console.log output?',
      transcript:
        COMMIT_DONE +
        '\nUser: push it and open a pr\n' +
        'Assistant: Pushed `fix/retry-backoff` and opened PR #118 with a summary of the cap ' +
        'and the new test.'
    },
    traps: ['git-commit', 'git-create-pr', 'tdd']
  },
  {
    id: 'co-review-estimate',
    category: 'carryover',
    session: {
      latestQuery: 'roughly how long would the top three fixes take?',
      transcript:
        'User: give the signup screen a holistic review and hand me one ranked list\n' +
        'Assistant: Ranked fixes: 1) the password error only shows on submit — validate ' +
        'inline; 2) body text is #9ca3af on white, 2.5:1 contrast — darken to #4b5563; ' +
        '3) the "Continue" button is below the fold on mobile — move it up; 4) the label ' +
        '"Email address" and placeholder repeat each other; 5) the spinner has no ' +
        'reduced-motion fallback.'
    },
    traps: ['better-interface', 'impeccable']
  },
  {
    id: 'co-animation-praise',
    category: 'carryover',
    session: {
      latestQuery: 'nice, that feels way better',
      transcript:
        'User: the toast just pops in, build a proper enter and exit animation\n' +
        'Assistant: Added a 200ms enter (translateY 8px → 0, opacity 0 → 1, ' +
        'cubic-bezier(0.2, 0, 0, 1)) and a 150ms exit, with a reduced-motion fallback to an ' +
        'opacity fade. Interrupting an exit mid-way now reverses from the current position.'
    },
    traps: ['animate']
  },
  {
    id: 'co-deploy-link',
    category: 'carryover',
    session: {
      latestQuery: 'send me the preview link again',
      transcript:
        'User: deploy this branch to a vercel preview\n' +
        'Assistant: Preview deployed: https://signup-revamp-git-feat-inline-errors.vercel.app ' +
        '— build took 41s, no warnings.'
    },
    traps: ['deploy-to-vercel', 'vercel-cli-with-tokens']
  },
  {
    id: 'co-radix-then-eslint',
    category: 'carryover',
    session: {
      latestQuery: 'separately, where is the eslint config in this repo?',
      transcript:
        'User: migrate the dialog and dropdown-menu off radix onto base ui\n' +
        'Assistant: Migrated both. `Dialog` now uses `@base-ui-components/react/dialog`; ' +
        'the dropdown uses `Menu`. Two stories in Storybook needed new prop names.'
    },
    traps: ['migrate-radix-to-base', 'shadcn']
  }
]
