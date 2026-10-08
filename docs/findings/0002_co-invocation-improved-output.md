# 0002: Co-invoking overlapping skills improved output, and the bands make it a dial

> [!NOTE]
> **Development finding:** live sessions on pre-release builds, n=1 per comparison. Not part
> of the [Results](../evaluation/results.md). Details:
> [`bench/results/`](../../bench/results/README.md).

> [!TIP]
> **Takeaway:** when several same-domain skills clear the bar together, a strong session
> model combined them into better work, not noise. If that ever hurts, fix the catalog first,
> then tighten thresholds.

## What we saw

- **Toast animation.** The arm that loaded four "extra" design skills alongside `animate`
  shipped a toast with textbook motion craft the single-skill arm lacked: an asymmetric
  250ms exit with shortened travel.
- **Design doc.** The arm whose verdict invoked the full design family ran the
  orchestrator's complete method, a 204-line design doc with philosophy, tokens, type, and
  motion. The stock session wandered for 76 seconds and never wrote the doc at all.

Co-invocation is the router *reporting* genuine catalog overlap, and, at least with a strong
session model synthesizing them, that overlap compounds instead of colliding. The cost is
tokens: ~2k per loaded SKILL.md.

## The dial

The posture is deliberately recall-biased and entirely tunable:

| Setting | Controls |
|---|---|
| `threshold` | The invoke bar (0.85 default; 0.9 for precision-minded hosts). |
| `suggestFloor` | The surfaced-not-invoked band beneath it. |
| `maxSelected` | Crowding. |
| `exclude` / `alwaysAllow` | The hard edges. |

**If co-invocation ever degrades output,** work down this ladder:

1. Run the [doctor](../guide/catalog-doctor.md). Overlap is usually a catalog fault: add
   "Not for Y" clauses or uninstall the redundant twin.
2. Then tighten thresholds.

**One compliance nuance:** obedient models load the verdict's full invoke list; others
cherry-pick, and which is which varies by model: in the 2026-10-08 A/B, opus loaded one of
four to six commanded design skills in most such turns
([0003](0003_invoke-is-a-command-suggest-is-a-menu.md)). So verdict breadth is a real dial
on a compliant model, and only a menu on the rest.
