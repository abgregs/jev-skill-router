# 0001: Hierarchies are read from descriptions, and shared territory co-invokes

**Evidence:** recorded runs (`build-animation`, `holistic-review`; captured 2026-10-01,
51-skill catalog, shipped `currentRequest` judge framing; re-captured the same day after the
judge's wording change, see [results](../evaluation/results.md#judge-wording-change-2026-10-01)).

> [!TIP]
> **Takeaway:** the router reads a skill suite's structure from descriptions alone, in both
> directions. Where several skills genuinely cover the ask, they all clear the bar; tune
> that with the doctor, `exclude`, and `threshold`.

## Context

Real catalogs contain **skill suites**: related skills by one author, where an orchestrator
routes to domain leaves. In the tested catalog, `better-interface` describes itself as the
orchestrator over the `better-*` leaves ("holistic review rather than a single domain"); the
leaves scope themselves to one domain each. Nothing in the router knows this structure. There
is no metadata and no naming heuristic; the hierarchy exists only in the descriptions.

## What we saw

| Skill | `build-animation` (one build task) | `holistic-review` (full UI review) |
|---|---|---|
| `better-interface` (orchestrator) | **0.09** | **0.97** |
| `animate` (animation leaf) | 0.97 | **0.04** |
| Domain skills for the ask | 0.94–0.98 | 0.86–0.98 |

- **Direction discrimination is sharp, both ways.** On the single-domain build task the
  orchestrator stays home; on the holistic ask it fires and the off-domain leaf stays out.
- **Skills sharing the asked-about territory co-clear the bar.** On the holistic ask,
  orchestrators and query-named leaves land at 0.86–0.98: eight skills clear the bar and
  the `maxSelected` cap of 6 binds. Three tie at 0.86 for the last slot, and catalog order
  puts `better-accessibility` in; `better-typography` and `make-interfaces-feel-better`
  overflow to the suggest band beside `emil-design-eng` (0.83) and `better-colors` (0.81).

An earlier judge framing consolidated this shape (leaves dominated below threshold). The
shipped `currentRequest` framing, adopted because it survives mid-session topic switches
([0004](0004_weight-current-request-over-transcript.md)), judges each skill independently
against the current request, so genuine same-territory relevance now reads as several
independent honest yeses.

## What it means

This is the recall-biased posture [0002](0002_co-invocation-improved-output.md) documents as
desirable: co-invocation is the router reporting real catalog overlap.

- **The control surface is explicit.** On this exact territory the
  [doctor](../guide/catalog-doctor.md) flags `better-ui ≡ make-interfaces-feel-better` as a
  near-verbatim duplicate (both fire 0.98 on the build task) and `impeccable` as an umbrella
  intruder. `exclude`, "Not for …" description clauses, and `threshold` tune the rest.
- **The ceiling is description quality.** A suite whose author writes no disambiguation
  clauses gives the judge nothing to read.
