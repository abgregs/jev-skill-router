# Catalog doctor

`jev-skill-router doctor` answers one question: is your catalog healthy *as a routing
surface*? It grades only what the router reads, SKILL.md `name` + `description`, so every
finding is a statement about those fields.

Every finding names its evidence and exactly one action: "uninstall X", "add a 'Not for Y'
clause to Z's description", "add W to exclude". Never a wall of similarity scores.

```bash
jev-skill-router doctor --no-probe   # always free: static findings only
jev-skill-router doctor --dry-run    # project the cost of a probe sweep
jev-skill-router doctor              # static findings + Jev probes
jev-skill-router doctor --json       # machine-readable report
```

## Static findings (free)

Plain code over name and description keywords:

| Finding | Meaning |
|---|---|
| **duplicate** | Near-verbatim descriptions. In the tested catalog, `better-ui` ≡ `make-interfaces-feel-better` at keyword Jaccard 0.62, a legacy rename; the next-closest pair sits at 0.33. |
| **unroutable** | A folder with no SKILL.md or no description. The loader silently skips these; the doctor surfaces them. Claude Code's own `synced/` and dot-folders like `.trash` aren't skills and are ignored. |
| **weak** | Too few keywords to fire on anything but exact wording. |
| **stale** | `alwaysAllow` or `exclude` entries naming uninstalled skills. |

## Overlap findings (Jev probes)

Overlap comes from probes, not similarity. Each skill's description is task-framed ("my
current task is squarely the kind of work this covers: …") and routed as a session against
the whole catalog. Co-invocation on a skill's home territory is *measured routing
confusion* under the configured threshold. Similarity can't do this job: on the real
catalog, the umbrella overlap between `impeccable` and `web-design-guidelines` peaks at
0.39 keyword containment, which is lexical noise.

| Verdict | What happened | Fix |
|---|---|---|
| **collision** | Mutual: each skill fires on the other's territory (real catalog: `prototype ↔ variant` at 0.95 both ways). Same job, different authors. | Keep your favorite, `exclude` the rest. |
| **overlap** | One-way: an intruder fires on a specialist's territory while the specialist stays home (real catalog: `impeccable` fires on 7 specialist territories). | Add a "Not for …" clause to the intruder's description. |
| **self-miss** | The router won't invoke a skill even on a task built from its own description. That probe is unusable, so it contributes no overlap conclusions. | Rewrite the description, then re-probe with `--only <ids>`. |

**Exemptions.** Suites are exempt from overlap findings: same-prefix families (`better-*`)
and skills whose descriptions cross-reference each other encode an author-designed
hierarchy the router already routes correctly
([finding 0001](../findings/0001_hierarchies-read-from-descriptions.md)). `alwaysAllow`
skills are exempt as intruders: you already decided they ride along.

## Cost

> [!NOTE]
> Each probe judges the whole catalog, so a sweep costs probes × catalog size (53 skills →
> 2,809 Nouls). The doctor projects it before spending and refuses past `--max-nouls`
> (default 3000). Without a key, a plain run reports the static findings and says the probes
> were skipped.

Probes judge with Jev by default, which is what finds semantic overlap; `--judge mock`
probes are free but see only lexical confusion.

<details>
<summary>Recording and replaying probe sweeps (dev tooling)</summary>

Paid sweeps never evaporate. Jev runs auto-record raw probe probabilities (no threshold
baked in) to `fixtures/recordings/doctor-probes.json`, `--only` re-probes merge into the
file, and `--replay <path>` re-runs the whole interpretation, at any `--threshold`, against
the capture with zero API calls. Each recorded probe snapshots the descriptions it judged,
so replay warns per probe when an edit has made its probabilities stale. This is dev and
eval tooling for iterating on the doctor, not a shipped feature.

</details>

## What it can't fix

Cross-author umbrella overlap can't be auto-fixed: `impeccable` and the review-oriented
skills all legitimately claim broad territory. The doctor surfaces the collision with
measured probabilities; the resolution is you picking a favorite, which is exactly what
`exclude` expresses. The CLI and hooks honor it, and the gate denies excluded skills unless
you slash-invoke them.
