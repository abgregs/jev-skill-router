# How routing works

```
session state  ──▶  1. JUDGE   (Jev)         one Noul per skill, sharded + parallel → p(0..1)
                    2. POLICY  (plain code)   threshold + rank → skills to invoke
```

Every skill in the catalog is judged, every time. No retrieval heuristics, no shortlist, no
index to go stale: the judgment layer sees the whole catalog, and plain code decides what to
do with the probabilities.

## 1. Judge

**Inputs.** The session state is the current prompt (`currentRequest`) and recent
conversation (`earlierConversationBackground`; the hook sends up to ~8,000 characters,
chosen by role with the last assistant message kept whole). The plugin and the CLI send
exactly these two fields. Each Noul pairs that state with one skill's name and description,
and is told to judge against the current request, treating the background as possibly
finished prior work ([finding 0004](../findings/0004_weight-current-request-over-transcript.md)),
with one exception: a prompt that is only a go-ahead ("go", "proceed") is judged against the
latest plan in the background, since that plan is what the user approved.

Jev's limit is 32k tokens of state per request; the hook's budget is far under it and is
set for accuracy, not size. TypeSafe documents that unrelated material in state costs
accuracy, and 0004 was that effect in practice.

**Why `Noul`, not `Choice`.** We want an *independent* probability per skill, and to select
*several* at once. `Choice` picks one winner from a single distribution (and caps at 255
options). `Noul` gives each skill its own p(should invoke), the number you threshold. See
the TypeSafe docs.

**Why judging everything stays fast.** Nouls are independent: no skill ever needs to see
another to be scored. So the catalog shards (250 Nouls per request by default) and the
shards fan out concurrently via `Promise.all`; wall-clock ≈ the slowest single shard, not
the sum.

| Catalog | Recorded wall-clock |
|---|---|
| Real, 51 skills (1 request) | 121–270ms |
| Synthetic, 1,064 skills (5 parallel shards) | 479–545ms |

This is also what scales past the 255 `Choice` cap: a Choice can't shard (shard winners
would never meet), while independent Nouls shard losslessly.

**The cost model is exactly one Noul per routed skill per routing decision**, plus one Noul
for each off-list skill call the [gate re-judges](../guide/claude-code-hooks.md#the-gate),
which is rare. Latency flattens with parallelism; spend doesn't. It's linear in catalog size. The honest cost
levers are catalog hygiene (`exclude`, the [doctor](../guide/catalog-doctor.md)), not a
lossy retrieval layer in front of the judge.

## 2. Policy: two bands and a cap

| Band | Rule (defaults) | What the model gets |
|---|---|---|
| **Invoke** | `p ≥ threshold` (0.85), top `maxSelected` (6) | "Invoke: …", a command to load the skill |
| **Suggest** | `suggestFloor ≤ p < threshold` (0.80–0.85), plus any invoke overflow past the cap | "Also relevant: …", named only, which is nearly free under progressive disclosure |
| — | below `suggestFloor` | nothing |

- The threshold is recall-biased, calibrated on the real-catalog fixtures; precision-minded
  hosts set `0.9`.
- On real catalogs the suggest band tends to hold secondary intents and suite leaves.
- In development sessions the bands carried different weight with the model: invoke was
  followed wholesale, suggest consulted when a need showed up
  ([finding 0003](../findings/0003_invoke-is-a-command-suggest-is-a-menu.md)).

All of these are settings: [configuration](../guide/configuration.md).
