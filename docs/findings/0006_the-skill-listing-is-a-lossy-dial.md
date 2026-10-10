# 0006: Claude Code's skill listing is a lossy dial, and the router is not on it

> [!NOTE]
> **Evidence:** Claude Code's documented behavior
> ([skills docs, "Skill descriptions are cut short"](https://code.claude.com/docs/en/skills#skill-descriptions-are-cut-short)),
> contrasted with the recorded synthetic-catalog runs
> ([results](../evaluation/results.md#synthetic-catalog-the-scale-story-only)). Nothing
> here measures the session model's selection quality at scale; that is an open question.

> [!TIP]
> **Takeaway:** stock skill selection reads a listing that is trimmed to a budget, so at
> scale the model matches some skills on their names alone, and which ones depends on your
> history. The router reads every description on every turn, and pays for it in Nouls.

## What Claude Code does

The skills docs describe the mechanism in full. Claude Code loads a listing of skill names
and descriptions into context so the model knows what is available. The listing always
contains every name, but when the descriptions exceed a character budget, Claude Code drops
descriptions to fit, and the docs say plainly that this "removes the keywords Claude needs
to match your request". The budget is 1% of the model's context window by default, set by
`skillListingBudgetFraction`. Descriptions are dropped starting with the skills you invoke
least, and each entry's text is capped at 1,536 characters regardless of budget. When the
listing overflows, the only signal is a warning in the debug log and a line in `/context`.

Three consequences follow, none of them a defect:

- **The dial is lossy by design.** It exists to bound context cost, and it pays for that
  by removing exactly the text selection depends on.
- **Visibility is history-dependent.** Two users with the same catalog can have different
  descriptions in context, because the least-invoked skills lose theirs first. The same
  prompt can select differently for each, and neither sees why.
- **There is no selection-time feedback.** A skill whose description was dropped does not
  announce itself; it is simply less likely to fire.

## What the router does instead

Every routed skill's name and full description reach the judge on every turn, as one Noul
each, sharded across parallel requests. The recorded synthetic runs judged 1,064 skills in
479–545ms over 5 shards, and the real 51-skill catalog in 121–270ms. There is no budget to
tune and nothing is trimmed; the cost is one Noul per routed skill per prompt, which grows
with the catalog ([how routing works](../architecture/how-routing-works.md#1-judge)).

## What this does not say

We did not measure how well the session model selects from a trimmed listing, or how its
selection latency compares; the model's choice is part of a response it was already
generating, so there is no separate step to time. The claim is about what each mechanism
can see, not about which chooses better at scale.
