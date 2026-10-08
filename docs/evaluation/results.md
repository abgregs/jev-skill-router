# Results: the released router, recorded runs only

> [!IMPORTANT]
> These are the only numbers this repo claims for routing quality: the 17 real-catalog runs
> in `fixtures/recordings/` and the 27 no-skill runs in `fixtures/recordings/no-skill/`
> (captured 2026-10-01), replayed through the shipped policy (threshold 0.85, suggest floor
> 0.80, cap 6). `npm run eval:report` prints every row below.

- **Same inputs as users:** Jev judged each run on what the plugin and CLI send, the prompt
  and the conversation tail.
- **Same policy, one wording change since:** the policy code is unchanged since capture. The
  judge wording gained a go-ahead exception on 2026-10-07; the drift check is
  [below](#judge-wording-change-2026-10-07) and the recordings were not replaced.
- **Reproducible:** `npm run demo:data` replays every row
  ([running evals](running-evals.md)).

## Real catalog (51 skills, 17 fixtures)

| Fixtures | Check | Result |
|---|---|---|
| 11 tasks | Needed skills invoked | **13 / 13** |
| 1 user-only skill (`disable-model-invocation`) | Left to the user | **1 / 1**, nothing invoked |
| 5 negative controls (asks for skills the catalog doesn't have) | No stand-in invoked | **5 / 5**: 4 invoked nothing; `maps-latency` invoked only its one needed in-catalog skill (`diagnosing-bugs`) |

What the scores look like:

- **Clear signal.** On every task the top-scoring skill landed at 0.97–0.99. On the four
  silent negative controls, the best wrong candidate topped out between 0.29 and 0.61.
- **Query decides.** The same orchestrator skill scored 0.09 on a single-domain build task
  and 0.97 on a holistic review ([finding 0001](../findings/0001_hierarchies-read-from-descriptions.md)).

## Caveats

- **Ground truth is ours.** One needed skill per part of the ask, labeled from the query and
  skill descriptions, never from a run's output. Related skills that also clear the bar are
  welcome and ungraded: the 11 task fixtures invoked 26 skills for 13 needed ones. On
  `holistic-review`, three skills tie at 0.86 for the last of the 6 slots; catalog order,
  not score, puts `better-accessibility` in and the other two in suggest.
- **Small and single-turn.** One capture per fixture. Read it as evidence, not a benchmark.
- **These grade the verdict, not the session.** Whether the model then loads and uses the
  skills was studied only in live sessions during development.
- **No cost or speed savings claim.** Nothing here measures one.

## No-skill prompts: needless loads

The task fixtures only show hits. This set shows the other side: prompts that need no skill,
where any invoked skill is a needless load. The prompts are in `fixtures/no-skill-sessions.ts`.

| Prompts (27) | Needless loads | Suggestions only | Highest wrong score |
|---|---|---|---|
| 5 acknowledgements, 3 codebase questions, 5 follow-ups after a skill-heavy turn, 5 plain edits, 2 knowledge questions, 7 routine commands | **0 / 27** | 0 / 27 | 0.62 |

- **Follow-ups hold.** After a turn that used a skill, a request that needs none scored that
  skill at 0.17 or less ([finding 0004](../findings/0004_weight-current-request-over-transcript.md)).
- **Small but vetted.** Each prompt was checked against every skill description: none
  names the work it asks for. Read 0 / 27 as none observed, not as a rate.

## Judge wording change (2026-10-01)

The judge's `false` option dropped "or a different skill fits better", which a Noul that
sees only its own skill cannot judge. The 17 runs were re-captured on the new wording the
same day. Every check above held. Scores rose slightly and consistently: 278 of 867 skill
scores went up, 8 went down, and the largest change was 0.09. The one changed verdict is
`holistic-review`, which gained `better-accessibility`.

## Judge wording change (2026-10-07)

The Noul gained one exception: a prompt that is only a go-ahead ("go", "proceed") is judged
against the latest plan in the background ([how routing works](../architecture/how-routing-works.md#1-judge)).
A same-day recapture on the same skills root checked the effect; it was **not** adopted as
the results above, because that root had shrunk to 38 skills (35 shared with the 51
recorded). Over the shared skills:

| Set | Pairs compared | Mean \|Δp\| | Pairs moving > 0.2 | Verdict changes |
|---|---|---|---|---|
| 14 task fixtures | 595 | 0.007 | 0 | 1: `mobile-list-perf` added `diagnosing-bugs` (0.82 → 0.85), a listed companion |
| 27 no-skill prompts | 945 | 0.008 | 7 | 0 needless loads, 0 suggestions |

The seven larger moves are all on acknowledgement or carry-over prompts, the branch the
exception touches: background skills rose (largest 0.09 → 0.51) but none reached the
suggest floor. Every check above held.

## Synthetic catalog: the scale story only

1,064 skills, 5 fixtures, captured 2026-09-22. Every skill judged in **479–545ms** across 5
parallel shards.

> [!NOTE]
> The catalog is generated from templates: near-duplicate skills that differ by service
> name, some with deliberately overlapping descriptions. That makes it a stress test for
> speed and sharding, not a fair accuracy test, so its picks are illustrative and not
> counted above.

- Its runs predate the plugin-inputs rule and include the fixtures' open files.
- Two of its labels were corrected on 2026-09-29, after capture, on the first side-by-side
  read of query and descriptions (see `fixtures/sessions.ts`).

## Development runs

Everything in [`bench/results/`](../../bench/results/README.md) and the findings marked
*development finding* came from pre-release builds while the router was being built. They
explain design decisions; they are not results for the released router.
