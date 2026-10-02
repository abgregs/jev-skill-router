# Results: the released router, recorded runs only

> [!IMPORTANT]
> These are the only numbers this repo claims for routing quality: the 17 real-catalog runs
> in `fixtures/recordings/` (captured 2026-10-01), replayed through the shipped policy
> (threshold 0.85, suggest floor 0.80, cap 6).

- **Same inputs as users:** Jev judged each run on what the plugin and CLI send, the prompt
  and the conversation tail.
- **Same code:** the judge prompt and policy code are unchanged since capture.
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
  silent negative controls, the best wrong candidate topped out between 0.27 and 0.52.
- **Query decides.** The same orchestrator skill scored 0.08 on a single-domain build task
  and 0.96 on a holistic review ([finding 0001](../findings/0001_hierarchies-read-from-descriptions.md)).

## Caveats

- **Ground truth is ours.** One needed skill per part of the ask, labeled from the query and
  skill descriptions, never from a run's output. Related skills that also clear the bar are
  welcome and ungraded: the 11 task fixtures invoked 25 skills for 13 needed ones.
- **Small and single-turn.** One capture per fixture. Read it as evidence, not a benchmark.
- **These grade the verdict, not the session.** Whether the model then loads and uses the
  skills was studied only in live sessions during development.
- **No cost or speed savings claim.** Nothing here measures one.

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
