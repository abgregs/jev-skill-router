# 0004: Verdicts must weight the current request over the transcript

> [!NOTE]
> **Development finding:** live sessions and bench runs on pre-release builds. Not part of
> the [Results](../evaluation/results.md). Details:
> [`bench/results/`](../../bench/results/README.md).

> [!TIP]
> **Takeaway:** frame the judge input so the current request leads and the transcript reads
> as background. And if you evaluate a router, your bench must include multi-turn sessions:
> first-turn accuracy says nothing about survival after a topic switch.

## The failure

Single-turn evals structurally can't catch this class of failure.

- The same two prompts that routed perfectly in every single-turn bench rep (3/3 each)
  returned **empty or suggest-only verdicts** when issued mid-session, after unrelated
  tasks. The judge's transcript tail, dominated by the *previous* task, drowned out the
  topic switch.
- The failure reproduced deterministically offline: replaying the identical prompts through
  `route-cli` with the live session's reconstructed tails flipped the verdicts exactly as
  observed. With a clean tail they routed fine.
- The gate made it worse: it turned the judge's miss into a session loss by denying the
  agent's own *correct* instinct against the empty verdict.

## The fix

The fix is in how the judge input is framed, not in dropping context:

- The session state names the latest query `currentRequest` and the tail
  `earlierConversationBackground`.
- Each Noul judges "against the current request alone", with the background explicitly
  marked as possibly finished prior work.

See [how routing works](../architecture/how-routing-works.md#1-judge) for the shipped input.

> [!NOTE]
> Since 2026-10-07 the framing carries one exception: a prompt that is only a go-ahead
> ("go", "proceed") is judged against the latest plan in the background, because on those
> turns the current request alone has nothing to judge. Topic switches still route on the
> prompt; the fixtures `go-*` and `switch-after-plan` in `fixtures/sessions.ts` cover both.

## Re-test

Live, across a five-prompt session with two hard topic switches:

- every expected skill routed (2.4–3.1s to first skill on the previously failing turns)
- zero gate denials
- the conversational control turn correctly routed nothing
