# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Static vanilla HTML/CSS/JS (user-confirmed 2026-09-21). The recorded demo renders
`web/data/*.json`, generated from `fixtures/recordings/*.json` by `npm run demo:data` —
no build step, no server-side judging, free to host anywhere. `web/serve.ts` is a local
preview convenience; the artifact itself is static.

## Users

Developers evaluating the Jev/TypeSafe pattern — engineers deciding whether typed,
thresholdable routing judgments are worth adopting in their own agent stacks. They land
on the demo as the proof artifact. Also skill authors (how a skill scores, where it
collides) and large-catalog maintainers (proof every skill is seen, a record of why one
fired). Secondary: readers arriving from the README/write-ups.

## Product Purpose

jev-skill-router routes coding-agent sessions to agent skills: judge (one Jev Noul per
skill, sharded and fanned out in parallel → p(should-invoke)) → policy (threshold + rank).
The recorded demo replays captured **real-Jev** runs deterministically, with no live API,
so visitors see genuine routing quality without anyone paying per pageview.

## Positioning

Honest numbers a neighboring demo can't truthfully copy: every probability shown was
produced by real Jev over a real installed skill catalog, recorded to JSON, and replayed
verbatim — including misses, negative controls, and dominated bands. The demo's replay
timing is driven by the actual recorded latencies from those runs.

## Operating Context

Visitors are terminal-native engineers who read benchmark tables, CI dashboards, and
eval harnesses daily. The demo is browsed casually (often from a README link) on desktop
first. Curated recorded runs: 17 real-catalog fixtures (51 routed skills, captured
2026-10-01), 5 synthetic-catalog scale fixtures (1,064 skills, Noul shard fan-out past
the 255 `Choice` cap), plus a doctor probe sweep (catalog-health/overlap findings).

## Capabilities and Constraints

- Priority order for the demo (user-confirmed): 1) honest routing with real numbers,
  2) the scale story (Noul shard fan-out over 1,064 skills), 3) the catalog doctor.
  All three appear; the first leads.
- Everything shown is pre-curated from recordings; nothing is judged live in the browser.
- Replay animation/content is timed to the actual result times captured in the
  recordings (e.g. `latencyMs` per run) — motion must not fake speed in either direction.
- Routing decides on name+description only (Agent Skills progressive disclosure).
- Policy vocabulary: threshold t=0.85 invoke, suggest band 0.80–0.85, `maxSelected` 6,
  negative controls report abstention (never P/R/F1).

## Evidence on Hand

`fixtures/recordings/*.json`: real per-skill probability maps, ground truth, thresholds,
judged counts, shard counts, and per-run latencies.
`lib/doctor.ts` findings (overlap collisions, umbrella-skill intrusions).
`bench/results/`: development-tier A/B sessions against stock skill selection (the router
covers more and costs more); never shown as a demo claim. No customer quotes, benchmarks
vs competitors, or adoption numbers exist — do not fabricate any.

## Product Principles

1. **The number is the product.** Probabilities, thresholds, and bands are the content;
   design serves their legibility.
2. **Never fake the data.** Recorded means recorded — misses and abstentions ship
   alongside hits; replay pacing follows measured latency.
3. **Show the mechanism, not a claim.** Judge → policy should be visible as structure,
   not described in prose.
4. **Free to host, free of keys.** Static artifact; determinism is a feature visitors
   can verify.
