# Running evals

`npm run eval:capture` runs the labeled fixtures with the **real Jev judge** (every skill
judged, one Noul each) and captures the full probability maps to
`fixtures/recordings/*.json`.

```bash
npm run eval:capture -- --dry-run                    # project the cost, no API calls
npm run eval:capture -- --catalog real               # every fixture, over the real catalog
npm run eval:capture -- --catalog real --fixtures payments-rollback
npm run eval:capture -- --catalog both --max-nouls 6000
```

## The two catalogs

| Catalog | Size | Role |
|---|---|---|
| **real** | The author's user-routable installed skills, read fresh each run (51 at the 2026-10-01 capture) | The quality anchor: curated ground truth, precision and recall per fixture, and negative controls. A negative control is an out-of-domain query whose only correct outcome is abstention, reported as abstention, never as P/R/F1. |
| **synthetic** | 1,064 skills (an org-scale catalog of confusable near-siblings) | The scale story: 5 parallel shards, ~0.5s wall-clock. Its picks are illustrative, not an accuracy claim ([results](results.md#synthetic-catalog-the-scale-story-only)). |

## Cost guard

> [!WARNING]
> Cost is real: one Noul per judged skill. Synthetic runs are ~1,000 Nouls *per fixture*,
> so the script projects spend up front and refuses to exceed `--max-nouls` (default
> `2000`) unless you raise it.

Scope a run with `--catalog real|synthetic|both` or `--fixtures <id,…>`. A fixture whose
`targets` don't include the catalog is still run, as a negative control: the only correct
outcome is invoking nothing. A fixture with no targets (`prd-from-convo`, retired because
its skill is user-only) records that way on every catalog. The key is read
from the environment or `.env.local` (git-ignored, loaded only if not already set).

## What a recording holds

Each file records the query, the fixture's ground truth, whether it's a negative control,
the full probability map, the selection, judged count, shard count, and latency. It also
stamps `judgedInputs`, the session fields Jev saw: the same prompt and transcript the plugin
and CLI send.

## From recordings to the demo

The recordings are the demo's entire data source. `npm run demo:data` replays every capture
through the real `route()` and policy code and writes `web/data/replays.json`; the page just
renders it. No key, no API: displayed latencies and shard counts are the
capture's own, never faked.

## The session bench

`npm run bench:session` is the other harness: a paired A/B of real headless Claude Code
sessions on the prompts in `fixtures/bench-sessions.ts`, one arm with the released hook
bundles and one with none. Each arm is one multi-turn session (`--per-fixture` for one
prompt per session), both arms launch together, and every turn runs to completion in both
arms (the only stops are a per-turn step cap and timeout, applied identically), so cost,
SKILL.md bytes loaded, and wall-clock are comparable across arms. Both arms route on a
project `.skillrouter.json` of `{exclude: [brief, debrief]}`, the recorded catalog's
definition.

```bash
npm run bench:session -- --dry-run
npm run bench:session -- --reps 3 --model opus
```

Cost is real on both meters: one Noul per routed skill per router-arm turn, and every turn
is a real session turn. Output lands in the gitignored `bench/session-results/`; keeper runs
are promoted to [`bench/results/`](../../bench/results/README.md). A session model is in
the loop, so these are development runs, never [results](results.md).
