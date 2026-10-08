# Keeper bench results

Curated snapshots of `npm run bench:session` output, promoted from the gitignored
`bench/session-results/` scratch dir so the evidence travels with the repo.

**Development runs.** Everything on this page, the manual smoke tests and probes included,
has a session model in the loop, so it is development tier whichever build ran: most of it
on pre-release builds while the router was being built, the 2026-10-01 cross-model probes
and the 2026-10-08 multi-turn cost A/B on the released bundles. These runs explain design
decisions; they are not claimed results. The only claimed results are the recorded runs in
docs/evaluation/results.md.

Token fields in the three September bench files (`tokensBeforeFirstSkill`, `outputTokens`
and the other per-run usage counters) were summed from the stream's per-message usage,
which undercounts output tokens badly; do not cite them. From 2026-10-08 the harness
reads usage from each turn's `result` event.

- `bench-2026-09-21T22-25-14.json` — 6 fixtures × 3 reps × 2 arms, sonnet.
  Run against the pre-rewrite router (prefilter shortlist still in place); the
  no-router arm is unaffected by that, router-arm latency/verdicts may differ
  from current code.
- `bench-2026-10-08T20-11-06.json` — multi-turn cost A/B on the released bundles,
  opus, 3 reps × 2 arms × 6 turns, symmetric stop rule; see its section below.
- `shard-sweep-2026-09-22T04-17-33.json` — real-Jev shard-size sweep on the
  63-skill installed catalog (shardSize ∈ {63, 50, 25, 10} × 3 reps,
  build-animation session). Wall-clock is flat across configs (~120–320ms,
  ranges overlap); sharding only adds input tokens (+19% at shardSize 10 from
  re-sent state). Verdict identical in all 12 runs. Conclusion: at real
  catalog sizes a single request is optimal; sharding is purely a
  scale/limits mechanism.
- `bench-2026-09-22T04-07-29.json` — small validation pass on the post-rewrite
  router (judge-all, no prefilter): 3 fixtures × 1 rep × 2 arms, sonnet.
  Reproduces the keeper pattern (no-router misses/junk, router hits). Open
  question: router-arm spawn→assistant was ~6s slower on skill fixtures while
  the hook self-reported only ~0.3–0.5s. (Resolved by the 17-39-53 run below:
  true hook cost is ~0.5–0.7s; the rest was CLI startup + API TTFB, present in
  both arms.)
- `bench-2026-09-22T17-39-53.json` — 6 fixtures × 3 reps × 2 arms, sonnet,
  first run on the instrumented harness (token capture on killed runs, external
  hook timing, provenance meta). 63 routable skills, real Jev, defaults
  (threshold 0.85, suggestFloor 0.8, maxSelected 6, shardSize 250).

  **Supported claims for this development build** (hit rate + time-to-event only — see validity note):
  router hit 11/18 expected-skill slots (61%) vs stock 6/18 (33%); router
  reached the right skill in 3–5s vs 11–50s-or-never for stock; negative
  control clean 3/3 in both arms; paired hook overhead (spawn→init delta)
  0.5–0.7s, of which ~0.5s hook wall and ~0.3s Jev network. Fewer turns to
  the goal, measured at the event (so not polluted by the early-kill): the
  router satisfied the full expected set in 8/15 skill-fixture runs, 6 of
  them within the FIRST assistant turn (median 1); stock satisfied 3/15 at
  turns 2, 4, and 5 (median 4). Every unsatisfied run in either arm burned
  to the turn cap.

  **Failure-mode asymmetry — read junk counts in context.** Both arms logged
  4 junk invocations, but the modes differ in kind. The stock arm's dominant
  failure is invoking NOTHING (0% on build-animation, a11y-widget, and
  design-doc-direction) or grabbing an off-target skill. All 4 router junk
  invocations were `brief` — a broad-but-applicable skill admitted by the
  recall-biased 0.85 threshold, exactly the admission class the threshold
  calibration documented. A broad-but-applicable inclusion is the intended
  happier failure mode: the turn still gets a relevant capability, versus the
  stock arm's silent miss where the expected skill never loads at all.
  Precision-minded hosts can set threshold 0.9; a rerun at 0.9 checking the
  `brief` junk against the design-doc/build-animation hits is the natural
  follow-up.

  **Correction from the 2026-09-22 manual smoke test (below): the junk
  metric here understates verdict junk.** This run's router verdicts for
  build-animation contained the same 6-skill invoke list the manual arm B
  received; sonnet simply ignored most of it (invoking only `animate`),
  while an instruction-compliant model (Fable) loads the whole list. Junk
  counts in this table measure *invocations*, which confound verdict
  precision with the session model's compliance.

  **Caveats.** Cross-arm cost/duration/token deltas remain unsupported: the
  expected-satisfied early kill fired 8× in the router arm vs 2× stock, so
  success and truncation are confounded until the symmetric stop-rule redesign
  lands. commit-and-pr scored 1/2 in all 6 runs of both arms (`git-create-pr`
  never fired — likely turn-cap/no-remote fixture artifact, not a router
  signal; the fixture is currently non-discriminating). n=3 per cell; both
  arms run bare Claude Code (`--setting-sources project`), not a personally
  configured session.

## Multi-turn cost A/B — 2026-10-08 (released bundles, opus, symmetric stop rule)

`bench-2026-10-08T20-11-06.json`. First run of the rewritten harness: each arm is ONE
streaming-input `claude -p` session carrying all six fixture prompts as sequential user
turns (the multi-turn session a real user has), hooks wired to the released `dist/hooks`
bundles, both arms on a project `.skillrouter.json` of `{exclude: [brief, debrief]}`
(shipped policy otherwise), 64 routed skills, opus, 3 reps × 2 arms = 36 turns. **Stop
rule symmetric:** every turn ran to natural completion in both arms (no early kill; the
step cap and turn timeout never fired), so for the first time the cost, token and
wall-clock deltas are comparable. Per-turn usage comes from each turn's `result` event;
session cost from the last one. Development-tier evidence under the repo doctrine
(model compliance is in the measurement), n=3 per cell.

| Per session (6 turns) | stock, 3 reps | router, 3 reps | delta (router − stock) |
|---|---|---|---|
| Expected-skill slots hit | 14/18 (78%) | 18/18 (100%) | +4, all on commit-and-pr |
| Negative control | silent 3/3 | silent 3/3 | — |
| Junk loads | 0 | 1 (emil-design-eng on build-animation, rep 3) | +1 |
| Gate denials / re-judges | — | 0 / 0 | — |
| SKILL.md bytes loaded | 74.5k, 80.8k, 74.5k | 86.1k, 121.3k, 113.4k | +11.6k, +40.4k, +38.8k |
| Cost (Claude Code estimate) | $0.90, $1.23, $0.97 | $1.10, $1.28, $1.42 | +$0.21, +$0.05, +$0.45 |
| Wall clock | 122s, 159s, 136s | 156s, 170s, 208s | +35s, +11s, +72s |
| Hook wall per turn | — | 0.3–0.4s (judge 250–357ms) | ≈ 2s of each wall delta |

**The router did not save cost or latency; it spent more of both.** The added spend has
two sources, both visible per turn in the JSON. (1) The workflow skills the stock arm
skipped: on commit-and-pr opus stock loaded nothing in two reps and git-commit alone in
the third, doing the commit with raw git in 10–19s; the routed arm loaded git-commit and
git-create-pr every rep and followed their process in 22–25s. The hits gap is entirely
this fixture. (2) Design-family co-invokes: the verdicts named 4–6 design skills on the
toast and design-doc prompts; opus loaded one of them in four of six turns and three
(+35k bytes) or two (+27k) in the other two. On the four task fixtures where stock
already hit (animate, better-accessibility, write-swift, impeccable: 12/12), the arms
loaded the same skill and the per-turn cost difference is noise.

What this supports: the router's value on a frontier model with this catalog is control
and coverage (workflow skills fire; no needless loads on either arm), not savings. A
public cost or latency claim for the router is not available from this run and should
not be made. Caveats: opus only; 64-skill catalog, not the 51 of the recorded runs;
`spawnToInitMs` in this file is the LAST init event (streaming mode emits one per turn;
fixed in the harness after the run); `usageFromMessages.outputTokens` undercounts (the
stream's per-message usage is partial) — use `usage` from the result event.

## Manual smoke test — 2026-09-22 (Fable 5, real config, one session per arm)

Protocol and scoring table: `bench/manual-ab-prompts.md`. Prompts 2–6 run in
both arms (prompt 1 skipped — needs a remote for the PR step). Arm A hook-free
(verified: empty state dir), arm B hooks live (verified: state file + (jev)
signature). Same model both arms: `claude-fable-5`.

**Scores (expected slots): arm A (stock) 4/5, 0 junk. Arm B (router) 2/5,
4 junk loads.** Both arms abstained cleanly on the negative control. On a
frontier model with the user's real config, the router HURT — for reasons
that are now diagnosed and reproducible:

1. **Multi-turn transcript contamination (2 of 3 arm-B misses, REPRODUCED).**
   The bench router hit write-swift and impeccable 3/3 on these prompts —
   but every bench session is single-turn. In arm B's continuous session,
   the hook's 2000-char transcript tail (full of prior toast/combobox work)
   flipped the verdicts: replaying the identical prompts through route-cli
   with the reconstructed tails reproduces arm B's live verdicts exactly
   (swift: [write-swift,brief] clean → [] with tail; design:
   [impeccable,…] clean → suggest-only with tail). The router as shipped
   degrades on topic switches mid-session. Fix, then re-test; the bench
   needs multi-turn fixtures to cover this class at all.
2. **Gate hard-deny + empty verdict is worse than no router on strong
   models.** Arm A Fable natively picked write-swift in 2.5s; arm B's gate
   denied that correct instinct against an empty verdict. Empty-invoke
   should probably fail open (or deny should demote to warn).
3. **Verdict junk surfaces on compliant models.** Fable loaded all 5
   commanded skills on build-animation (~2k tokens each); sonnet had
   masked the same verdict by under-complying.

**Artifact-level comparison** (git diffs of both worktrees): where both arms
had the same right skill (a11y), output was near-identical and canonical —
the skill homogenizes quality. On the toast, arm B's extra design skills
left a visible craft edge (asymmetric 250ms exit with shortened travel vs
arm A's symmetric 400ms) — the "junk" wasn't valueless, consistent with the
broad-but-applicable framing. On swift, arm B produced a competent actor
migration despite the denial (frontier-model floor is high); arm A with
write-swift chose @MainActor+async, matching the skill's doctrine. On the
design prompt, an inversion: arm A (two leaf skills) never wrote the
requested DESIGN.md; arm B (zero skills) followed the instruction to the
letter. n=1 throughout — patterns, not proofs.

**On multi-skill design-family verdicts (post-fix design+tail invokes six):
working as designed; the remedy is catalog hygiene, not threshold surgery.**
The artifact evidence cuts in favor of these co-invocations — arm B's toast
gained real motion craft from the "extra" skills, and each admitted skill
cleared the same 0.85 bar individually. When several same-family skills
clear the bar together it means the catalog genuinely contains that much
overlapping coverage; the router is reporting the overlap, not inventing
it. The catalog doctor exists for exactly this: if you don't want a suite
co-loading on similar problems, run the doctor and act on its findings
(uninstall the redundant skill, or add a "Not for Y" clause so the
descriptions separate). Threshold 0.9 remains available for
precision-minded hosts, but it treats the symptom; the doctor treats the
cause. Overcrowding limits (maxSelected) can be revisited separately.

The 48-vs-63 judged/routable gap is RESOLVED: route-cli defaults to the
provider-neutral `~/.agents/skills` store while Claude Code loads
`~/.claude/skills`, and the stores had drifted by 16 skills (cloudflare
suite, wrangler, sandbox, web-perf, …) — the hook could never route to
those, and the gate would deny the model's own attempts. Fixed by pointing
the Claude Code adapter at its host's catalog (`--skills-dir`); verified
live (a wrangler prompt now routes to wrangler/cloudflare/workers, 53
judged = 63 routable − 10 user-only).

**Re-test after the fixes (run-b2, 2026-09-22, Fable 5, prompts 2–6): clean
sweep — 5/5 expected cores, zero gate denials, negative control silent.**
First run in the project (bench included) to hit every expected core.
write-swift landed in 2.4s and impeccable in 3.1s on the very topic-switch
turns that failed pre-fix; 53 judged every turn (skills-dir fix live);
judge latency 372–647ms. The suggest band behaved exactly as designed:
five suggestions across the run (brief ×2, web-design-guidelines,
better-typography, make-interfaces-feel-better), zero loaded — the model
treated them as optional and the web-design-guidelines trap stayed
un-invoked. Family co-invocations remain (4 design loads on the toast, an
impeccable tag-along on the combobox) — catalog-hygiene territory per the
doctrine above, not verdict failure. Artifacts: impeccable's full process
ran on prompt 5 (204-line DESIGN.md + PRODUCT.md + .impeccable/ working
dir) versus arm A's no-doc miss and pre-fix arm B's skill-less doc.
Cross-run scoreboard (same prompts, same model): stock 4/5 with a design
miss; pre-fix router 2/5 with a denial; post-fix router 5/5.

**Suggest-band uptake probe (2026-09-22, 3 headless Fable sessions).** Prior
runs showed 13 suggest placements with zero loads — but in all of them the
invoke band already covered the need, so skip-vs-uptake was indistinguishable.
The probe manufactures the missing condition: workspace `.skillrouter.json`
with `threshold: 1.01` forces every relevant skill into the suggest band
(verified: all three verdicts had `invoke: []`, suggests of 5, 2, and 7).
Results — the band is live in both directions:

- **Up-front uptake:** on the toast-animation prompt the model's literal
  first action was invoking suggested `animate`, before reading a single
  file (1 of 5 suggestions taken).
- **Mid-turn uptake:** on the swift prompt it explored first (glob, ls,
  read) and invoked suggested `write-swift` as its 4th tool call; on the
  motion+tokens prompt it invoked suggested `animate` as its 5th call after
  investigation (1 of 2 and 1 of 7 taken).
- **Selective, not compliant:** in every probe the model took exactly the
  one task-central suggestion and ignored the co-suggested family
  (impeccable, better-ui, emil-design-eng…) — it even wrote a tokens.css
  bare while suggested `better-colors` sat unused. Contrast the invoke
  band, which a compliant model loads wholesale (b2's toast). The two
  bands have empirically distinct semantics: invoke = command (all load),
  suggest = menu (need-driven pick, often none).
- Zero gate denials — suggests are on the approved list by design, now
  exercised live for the first time.

Unified read across all runs: the model draws from the suggest band only
when the invoke band hasn't already covered the need. The earlier "13
placements, 0 loads" was correct behavior, not a dead letter.

**Confirmed: an empty invoke list with a populated suggest list is a
healthy verdict shape, not a failure mode.** All three probes handed the
model (Fable) exactly that shape (`Invoke: [—]` + suggestions) and it
handled it correctly every time — no confusion, no stalling, no off-list
attempts: it worked the task and pulled in the one suggestion it needed,
when it needed it. This splits the earlier "empty verdict" concern into
two distinct regimes: invoke-empty/suggest-populated is fine (the gate
approves the whole suggest band, so the model retains sanctioned skill
access); invoke-empty/suggest-EMPTY is the dangerous shape — the gate then
denies everything unlisted (pre-fix arm B's write-swift denial). The open
fail-open question applies only to the fully-empty verdict, and post-fix
no fully-empty verdict has recurred on a skill-shaped prompt.

## Stock model probes — 2026-09-25 (a11y prompt, skill-invocation only)

Two ad-hoc stock probes for the demo opener's model-variance claim: `claude -p`
with the a11y-widget fixture prompt, `--setting-sources project` (no hooks, bare
config), `--max-turns 4`, models `haiku` and `opus`. Both invoked ZERO skills —
straight to exploration (find/ls/read) despite better-accessibility being
installed and on-point. Combined with the recorded sonnet 0-of-3 (17-39-53 run)
and the manual arm A Fable hit, the same prompt now has recorded stock outcomes
across four models: one hit (fable), three silent no-loads. Transcripts were not
retained; reproduce with the command above. n=1 per new model — a pattern check,
not a benchmark.

## Routed cross-model probes — 2026-09-25 (a11y prompt, hooks live, jev)

Same prompt, hooks on, sessions on haiku/sonnet/opus (fable covered by run-b2):
**invoke verdict identical in all — [better-accessibility, diagnosing-bugs]** —
matching 6/6 offline route-cli runs (p=0.98–0.99/0.91–0.92; suggest band edge
wobbled once: impeccable 0.84→0.85). Judgment is model-independent, measured.
Execution is not: sonnet and opus loaded the invoke list exactly; haiku loaded
nothing despite the commanded verdict (n=1, 4-turn cap) — the compliance
asymmetry again. Probe gotcha for the record: a first haiku attempt inherited
the parent session's environment and its hook routed a leaked <task-notification>
payload (correctly to an empty verdict) — nested claude -p probes need a clean
env before reading their state files.

## Cross-model probes re-run — 2026-10-01 (released router, both arms)

Re-run of the two 2026-09-25 probes with `bench/cross-model-probe.sh`, which now feeds the
demo opener. Same a11y-widget prompt, a fresh stub workspace per session, `--max-turns 4`,
clean environment (`env -i`). **Stock:** the installed plugin switched off; every session
listed 95 skills including better-accessibility. **Routed:** the installed plugin switched
off and the working tree loaded with `--plugin-dir`, so the hooks were the current code.
n=1 per model per arm (the stock arm ran twice after an interrupted first attempt, with the
same skill outcome per model): a pattern check, not a benchmark. Transcripts stayed local
in the gitignored `bench/session-results/cross-model-20261001-221212/`.

| Model | Stock: skills loaded | Routed: skills loaded |
|---|---|---|
| fable | better-accessibility (first action) | better-accessibility, diagnosing-bugs |
| sonnet | better-accessibility (first action) | better-accessibility, diagnosing-bugs |
| opus | better-accessibility (after one exploratory Bash) | better-accessibility |
| haiku | none (Bash → Read → Edit) | better-accessibility |

Routed verdict identical on all four: invoke [better-accessibility, diagnosing-bugs],
suggest [brief] (the live config routes `brief`; the recordings exclude it, hence their
suggest [impeccable]). Every routed session loaded better-accessibility as its first action.

**What changed from 2026-09-25.** The stock result reversed: three of four models found the
skill, where the earlier probes recorded one (fable) and three no-loads. The likely cause is
the earlier setup, not the models: those probes used `--setting-sources project`, which may
have kept personal skills from loading at all (transcripts weren't kept, so it can't be
checked), and sonnet's 0-of-3 came from the development bench. Routed compliance also moved:
haiku now loads the lead skill (it loaded nothing before), and opus loaded one of the two.

**What still separates the arms on this prompt:** haiku loads a skill only when routed;
diagnosing-bugs loads only when routed (0/4 stock, 2/4 routed); and routed sessions load the
skill before anything else. The demo opener's rotor and captions were updated to these runs.

## Judge repeat-call variance — VERIFIED 2026-09-26 (supersedes earlier micro-test)

Four systemOne calls with REQUEST BODIES CONFIRMED BYTE-IDENTICAL (fetch
intercepted, sha256 715d3d4d49684865, 2736 bytes, empty diffs — reproduce with
bench/jev-determinism-probe.mjs). The service returned three distinct
probability vectors: better-accessibility 0.99/0.98/0.99/0.99, brief
0.83/0.82/0.83/0.83, diagnosing-bugs 0.91/0.91/0.92/0.92 (earlier runs also
showed 0.82–0.84 on brief). Every score carries ~±0.01 repeat-call variance
and it is service-side — no state difference existed. SOURCE CHECK
(typesafe-determinism-claim.md, 2026-09-26): TypeSafe's primary docs make NO
exact-determinism claim. Their strongest statements are "designed to return
stable answers across repeated evaluations" and "quantitatively similar
outputs for semantically similar inputs," and their consistency cookbook
PUBLISHES a mean per-question probability standard deviation of 0.0102. Our
measurement therefore CONFIRMS the vendor-documented behavior rather than
refuting any promise — the "exact same numerical probabilities" wording traces
to a third-party blog, not to TypeSafe. (One loose end: the typesafe.ai
homepage FAQ lists "Is Jev deterministic?" but the answer body was not
retrievable.) Interpretation for cross-model results: the identical invoke
verdicts across four session models were achieved ON TOP of this documented
noise floor, because real-catalog scores sit far from the cuts. Suggest-band
flicker lies entirely within the noise floor and needs no model-dependent
explanation.
