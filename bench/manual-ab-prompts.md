# Manual A/B smoke test — prompt script

Seed project: `~/Developer/jev-ab-seed` (fixed commit `c80ac4e`, retry-backoff patch
staged, `.skillrouter.json` judge=jev). **Never run a session in the original seed** —
copy it fresh per arm so file edits and auto-memory can't leak between arms:

```bash
cp -R ~/Developer/jev-ab-seed ~/Developer/jev-ab-run-a   # arm A (no hook)
cp -R ~/Developer/jev-ab-seed ~/Developer/jev-ab-run-b   # arm B (hook)
```

Different paths per arm is deliberate: auto-memory is keyed by project path.

## Per-arm checklist

Before EITHER arm: `rm -f "$TMPDIR/jev-skill-router/turn-"*.json`

Arm A (no hook): `hooks` block REMOVED from `~/.claude/settings.json`.
After arm A, confirm no `turn-*.json` appeared in `$TMPDIR/jev-skill-router/`
(if one did, a hook fired — arm void).

Arm B (hook): restore the hooks block (paths under `~/Developer/jev-skill-router`).
Positive control first, in a scratch dir: the signature line
`jev-skill-router · invoke […] · N judged (jev)` must appear and say **(jev)**.

Reply policy if Claude asks anything: answer exactly "proceed with your recommendation".
Let every turn run to natural completion. No other interjections.

## Prompts — paste verbatim, one per turn, same order in both arms

These are the six harness fixtures (fixtures/bench-sessions.ts), so results are
directly comparable to the automated bench.

1. commit the staged retry-logic changes with a proper conventional message, then push the branch and open a pr for review
2. the notification toast just pops into existence — build a proper enter and exit animation for it and pick the right curve and duration
3. our custom combobox is broken for keyboard users and voiceover announces nothing — fix the focus management and aria wiring
4. migrate this module to swift 6 strict concurrency — fix the sendable warnings and decide what should be main-actor isolated versus moved onto an actor
5. design the visual direction for the jev-skill-router recorded demo — philosophy, color tokens, type, motion principles — and write it to a design doc before any UI code
6. quick question while I have you — what does "idempotent" mean for HTTP methods, and why does it matter for retries? just explain, no code changes needed

## Scoring (fill in per arm: which skills were invoked per prompt)

| # | expected (required core)  | acceptable (neither hit nor junk)                                          |
|---|---------------------------|----------------------------------------------------------------------------|
| 1 | git-commit, git-create-pr | —                                                                          |
| 2 | animate                   | —                                                                          |
| 3 | better-accessibility      | diagnosing-bugs                                                            |
| 4 | write-swift               | —                                                                          |
| 5 | impeccable                | better-colors, better-typography, apple-design, emil-design-eng, better-ui |
| 6 | NONE (negative control)   | —                                                                          |

Valid readout at n=1: per-prompt hits and junk only. `/cost` and wall-time are
anecdotes, not deltas (see bench/results/README.md validity notes).
