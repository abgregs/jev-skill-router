# Findings

What building and measuring the router taught us. Each finding states its evidence source:

- **Recorded runs:** real-Jev recordings replayed through the shipped policy, the same data
  as [Results](../evaluation/results.md). Only the judge is measured.
- **Development finding:** anything with a session model in the loop: live sessions, A/B
  benches, probes, on any build. These explain design decisions; they are not results for
  the released router.
  **Why:** the tier follows what is measured, not which build ran. A bench on the released
  bundles still mixes the session model's compliance into its numbers, so its figures stay
  development tier. Replaces the "pre-release builds" wording (2026-10-08).
- **Documented behavior:** a fact about the host taken from its own docs, cited by link,
  and contrasted with recorded runs. It is a claim about what each mechanism can see, not
  a measured comparison.

| # | Finding | Evidence |
|---|---|---|
| [0001](0001_hierarchies-read-from-descriptions.md) | Skill hierarchies are read from descriptions alone, and skills sharing the asked-about territory co-invoke. | Recorded runs |
| [0002](0002_co-invocation-improved-output.md) | Co-invoking overlapping skills improved output, and the bands make it a dial. | Development |
| [0003](0003_invoke-is-a-command-suggest-is-a-menu.md) | Models follow the invoke band wholesale, to a degree that varies by model, and consult the suggest band only when needed. | Development |
| [0004](0004_weight-current-request-over-transcript.md) | Verdicts must weight the current request over the transcript, and benches need multi-turn sessions. | Development |
| [0005](0005_the-verdict-is-a-snapshot.md) | The verdict is a snapshot of the prompt; the gate asks Jev about any off-list call before denying it. | Development |
| [0006](0006_the-skill-listing-is-a-lossy-dial.md) | Claude Code's skill listing is budgeted and trimmed least-invoked first; the router reads every description every turn. | Claude Code docs, recorded runs |

New findings take the next number: `NNNN_short-kebab-title.md`, listed here.
