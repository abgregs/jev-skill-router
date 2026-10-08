# 0003: Invoke is a command, suggest is a menu, and models treat them that way

> [!NOTE]
> **Development finding:** live sessions on pre-release builds with a frontier session
> model. Not part of the [Results](../evaluation/results.md). Details:
> [`bench/results/`](../../bench/results/README.md).

> [!TIP]
> **Takeaway:** the two bands carry two different speech acts. `threshold` and
> `suggestFloor` tune not just what gets selected but how imperatively the model is
> addressed about each skill.

## What we saw

- **The invoke band is obeyed wholesale.** A compliant model loads every commanded skill.
  Compliance varies by model: in the 2026-10-08 A/B, opus loaded one of the four to six
  commanded design-family skills in four of six such turns, and two or three in the other
  two.
- **The suggest band is consulted, not obeyed.** Forced suggest-only verdicts (threshold set
  above 1.0, so nothing could reach the invoke bar) showed the model taking exactly one
  task-central suggestion per session, sometimes as its literal first action, sometimes
  mid-turn after exploring the code, and ignoring the co-suggested family every time.
- Across all recorded sessions, the model drew from the suggest band only when the invoke
  band hadn't already covered the need.

## What it means

- **An empty invoke list with populated suggests is a healthy verdict.** The model works the
  task normally and keeps sanctioned access to the whole suggest band (the gate approves
  it), pulling in a suggestion exactly when needed. This is the router's designed channel
  for needs that only emerge mid-turn.
- **The shape to watch is the fully empty verdict,** where the gate denies every routed
  skill. That's where fail-open policy matters.
- **This is a control stock skill selection doesn't have:** a per-skill choice between
  "load this" and "this is available if you need it."
