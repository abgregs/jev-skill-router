# Evaluation

| Doc | What's in it |
|---|---|
| [results.md](results.md) | The only routing-quality numbers the repo claims: recorded runs on the released router, with their caveats. |
| [running-evals.md](running-evals.md) | How `npm run eval:capture` records real-Jev runs, what it costs, how the demo replays them, and the paired session bench. |

**Development runs** live in [`bench/results/`](../../bench/results/README.md): A/B
sessions, smoke tests, and probes, on any build. A session model is in the loop, so they
explain design decisions and aren't results for the released router
([the tiers](../findings/README.md)).
