# 0005: The verdict is a snapshot, so the gate asks before it denies

> [!NOTE]
> **Development finding:** live sessions and hook probes on the released bundles, plus the
> 2026-09-22 smoke test on a pre-release build. Not part of the
> [Results](../evaluation/results.md). Details: [`bench/results/`](../../bench/results/README.md).

> [!TIP]
> **Takeaway:** a routing decision made before the work begins cannot know what the work
> will turn out to need. Enforce it as a filter with a question at the edge, not as a lock.

## The failure

The verdict is judged on the prompt and the conversation so far, before the model has read
a file. Two things that happen next were invisible to it:

- **The task reveals a need the prompt never named.** "Pull the revenue table out of the
  board deck into a spreadsheet" routes the spreadsheet skill; the deck turns out to be a
  PDF. A convention the project docs point at, a format a file turns out to have: the
  first anyone learns of it is when the model reaches for the skill.
- **The judge misses, and the model is right.** In the 2026-09-22 smoke test the judge
  returned an empty verdict on a Swift migration after a topic switch
  ([0004](0004_weight-current-request-over-transcript.md)). The model reached for
  `write-swift` on its own, and the gate denied it. A hard gate turned a judge miss into a
  session loss.

## The fix

Before denying an off-list call, the gate asks Jev one question about that one skill:
does loading it serve the request, given the same prompt and background the verdict saw,
plus the arguments the model passed? It allows at 0.5 or above. The floor sits below the
routing threshold on purpose: routing asks whether the request clearly calls for a skill,
while this asks whether the load plausibly serves the work, and the model's own reach is
evidence the verdict never had. One Noul, spent only on off-list calls, each one logged
([the gate](../guide/claude-code-hooks.md#the-gate)).

## What we saw

Live hook probes on the released bundles, 2026-10-07, from the gate's own log:

| Prompt | Call | Score | Result |
|---|---|---|---|
| Pull a table out of a board deck; the deck turns out to be a PDF | `anthropic-skills:pdf` | 0.96 | allowed |
| same | `write-swift` | 0.03 | denied |
| A bare "proceed" with no conversation behind it | `anthropic-skills:pdf` | 0.83 | allowed |
| same | `write-swift` | 0.34 | denied |
| A third prompt, to check the floor cuts both ways | `tdd` | 0.75 | allowed |
| same | `anthropic-skills:pdf`, `write-swift` | 0.05, 0.10 | denied |

Across the 36 turns of the 2026-10-08 opus A/B the model never left the verdict's list, so
the question was never asked there. The re-judge is a safety valve, not a second router.
