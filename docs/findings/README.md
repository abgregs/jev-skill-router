# Findings

What building and measuring the router taught us. Each finding states its evidence source:

- **Recorded runs:** the released router, same data as [Results](../evaluation/results.md).
- **Development finding:** live sessions or bench runs on pre-release builds. These explain
  design decisions; they are not results for the released router.

| # | Finding | Evidence |
|---|---|---|
| [0001](0001_hierarchies-read-from-descriptions.md) | Skill hierarchies are read from descriptions alone, and skills sharing the asked-about territory co-invoke. | Recorded runs |
| [0002](0002_co-invocation-improved-output.md) | Co-invoking overlapping skills improved output, and the bands make it a dial. | Development |
| [0003](0003_invoke-is-a-command-suggest-is-a-menu.md) | Models follow the invoke band wholesale and consult the suggest band only when needed. | Development |
| [0004](0004_weight-current-request-over-transcript.md) | Verdicts must weight the current request over the transcript, and benches need multi-turn sessions. | Development |

New findings take the next number: `NNNN_short-kebab-title.md`, listed here.
