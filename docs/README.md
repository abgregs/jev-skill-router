# Documentation

Everything past the [project README](../README.md): how to install and tune the router,
how it works, what the evals show, and what we learned building it.

| Section | What's in it |
|---|---|
| [Guide](guide/README.md) | Install, configure, and use the router day to day: plugin and CLI setup, `.skillrouter.json`, the `route` and `doctor` commands, the Claude Code hooks. |
| [Architecture](architecture/README.md) | How a routing decision is made (judge every skill in parallel, then plain-code policy) and where the code lives. |
| [Evaluation](evaluation/README.md) | The recorded results the repo stands behind, their caveats, and how to capture new runs. |
| [Findings](findings/README.md) | Numbered write-ups of what the recorded runs and development sessions taught us. |

> [!IMPORTANT]
> Routing-quality claims come only from the recorded runs in
> [Evaluation → Results](evaluation/results.md). Development runs (`bench/results/`) and
> findings marked *development finding* have a session model in the loop, on any build;
> they explain design decisions and are not claimed results.

## Cross-cutting axes

Concerns whose rules are spread across sections, audited one per debrief for whether the
rules still compose.

| Axis | Where its rules live | Last audited |
|---|---|---|
| Judge inputs (prompt, background, framing) | [hooks guide](guide/claude-code-hooks.md#what-jev-reads), [how routing works](architecture/how-routing-works.md#1-judge), [results](evaluation/results.md), findings [0001](findings/0001_hierarchies-read-from-descriptions.md), [0004](findings/0004_weight-current-request-over-transcript.md) | 2026-10-07 |
| Gate permissions (what passes the `Skill` tool) | [hooks guide](guide/claude-code-hooks.md#the-gate), [configuration](guide/configuration.md), [README](../README.md#how-it-works) | — |
| Evidence tiers (recorded runs vs development) | this page, [evaluation](evaluation/README.md), [results](evaluation/results.md#development-runs), [findings](findings/README.md), [bench notes](../bench/results/README.md) | 2026-10-08 |
