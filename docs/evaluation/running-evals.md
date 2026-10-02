# Running evals

`npm run eval:capture` runs the labeled fixtures with the **real Jev judge** (every skill
judged, one Noul each) and captures the full probability maps to
`fixtures/recordings/*.json`.

```bash
npm run eval:capture -- --dry-run                    # project the cost, no API calls
npm run eval:capture -- --catalog real               # the 17 real-catalog fixtures
npm run eval:capture -- --catalog real --fixtures payments-rollback
npm run eval:capture -- --catalog both --max-nouls 6000
```

## The two catalogs

| Catalog | Size | Role |
|---|---|---|
| **real** | 51 skills (the author's user-routable installed skills) | The quality anchor: curated ground truth, precision and recall per fixture, and negative controls. A negative control is an out-of-domain query whose only correct outcome is abstention, reported as abstention, never as P/R/F1. |
| **synthetic** | 1,064 skills (an org-scale catalog of confusable near-siblings) | The scale story: 5 parallel shards, ~0.5s wall-clock. Its picks are illustrative, not an accuracy claim ([results](results.md#synthetic-catalog-the-scale-story-only)). |

## Cost guard

> [!WARNING]
> Cost is real: one Noul per judged skill. Synthetic runs are ~1,000 Nouls *per fixture*,
> so the script projects spend up front and refuses to exceed `--max-nouls` (default
> `2000`) unless you raise it.

Scope a run with `--catalog real|synthetic|both` or `--fixtures <id,…>`. The key is read
from the environment or `.env.local` (git-ignored, loaded only if not already set).

## What a recording holds

Each file records the query, the fixture's ground truth, whether it's a negative control,
the full probability map, the selection, judged count, shard count, and latency. It also
stamps `judgedInputs`, the session fields Jev saw: the same prompt and transcript the plugin
and CLI send.

## From recordings to the demo

The recordings are the demo's entire data source. `npm run demo:data` replays every capture
through the real `route()` and policy code and writes `web/data/replays.json`; the page just
renders it. No key, no API, deterministic: displayed latencies and shard counts are the
capture's own, never faked.
