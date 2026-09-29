# DESIGN.md — jev-skill-router recorded demo

Visual authority for the `web/` recorded-replay rework. Written **before** UI code as
the build contract (user-directed); reconcile against the built surface at the finish
review. Product truth lives in [PRODUCT.md](./PRODUCT.md); the surface's direction
contract lives in `.impeccable/surfaces/web-index-html.md`.

---

## 1. Philosophy — The Living Technical Report

The demo is not a page *about* an eval. **The demo is the eval report, and its figures
are alive.** Lineage: Bell Labs technical memoranda, NASA mission reports, ML
eval-paper tables — the one print tradition the audience (engineers deciding whether
to adopt Jev routing) already trusts on sight.

Five commitments, in priority order:

1. **The number is the product.** Probabilities, thresholds, and bands are the content.
   Every visual decision serves their legibility; nothing decorates them.
2. **No number without its receipt.** Every figure carries an inseparable caption with
   its provenance: fixture id, catalog, Nouls judged, shards, recorded latency, capture
   date. A claim without a receipt does not ship.
3. **Truth-timed motion.** Anything that replays recorded work moves at the recorded
   speed — `latencyMs` from the fixture JSON, never an invented duration. The design
   may dramatize only what was measured. (Judging 53 skills took 325 ms; the figure
   fills in exactly 325 ms.)
4. **States are ink, not chrome.** Selected is solid overprint; suggested is a mid
   impression; dominated is dry ghost ink. Nothing grays out; ink density carries state.
5. **Misses ship too.** Negative controls, abstentions, the missed `write-postmortem`
   truth — the report prints them at the same craft level as the hits. Honesty is the aesthetic.

What this refuses: the dark dev-tool dashboard (the pre-rework `web/` look — cards,
blue accent, mono badges), and the editorial-broadsheet rut one door over (cream ground,
italic display serif, tracked-mono labels as garnish). This is instrument-and-typewriter
report craft. If it stops looking like a document someone measured things into, it has
drifted.

Anatomy of the artifact — four exhibits in the confirmed priority order:
**Figure 0** the mechanism — *what the router does*, taught by replaying one real
recorded turn (shares the first viewport with the masthead; the abstract alone was
measured not to carry this job); **Figure 1** honest routing on the real installed
catalog (51 skills, both bands); **Figure 2** the scale story (~1,064 synthetic
skills, Noul shard fan-out past the 255 `Choice` cap); **Table 3** the catalog
doctor (overlap collisions, umbrella intrusions). The former Figure 4 (the multi-turn
session record) was CUT from the demo (2026-09-28): methodology-grade evidence felt
too in-the-weeds for a demo whose visitor needs what the tool does and how it will
work, not how we got there — the session protocol and results live on in
bench/results/. Dense figure, quiet prose,
dense figure — paced like a paper. Navigation is the sliding spotlight (user-confirmed
over a true pager): the document stays one scrolling report, every exhibit mounted, so
find-in-page, deep links (plain anchors), skim, and print all survive. A minimal sticky
rule past the masthead carries four short chips (Mechanism · Catalog · Scale · Doctor;
current one highlighted by scrollspy) with prev/next squares: the single
navigation surface (per-exhibit foot buttons were tried and removed as interruptive —
one nav system, not two). Nav clicks fade the page out
120ms, jump instantly, fade back in 180ms — a page turn without unmounting anything.
Manual scrolling is never hijacked; reduced motion jumps with no fade. No hash routing:
anchor ids are the addressing scheme.

## 2. Color

**Strategy:** full palette, four named roles on a paper ground. Light mode only — the
scene is an engineer reading a report at a lit desk, and paper is the world's material.
(No dark theme; the recorded terminal cast was the dark direction, and it lost the roll.)

Notation is `oklch()` with sRGB hex fallback (new system; the incumbent hex tokens are
replaced wholesale). All values below were converted and contrast-measured — see §2.3.

### 2.1 Primitives (named by hue, never used in components)

```css
:root {
  /* paper — warm near-white neutral ramp, hue 90 */
  --paper-0:    oklch(0.975 0.006 90);  /* #f8f7f2 */
  --paper-1:    oklch(0.950 0.008 90);  /* #f0eee9 */
  --paper-2:    oklch(0.915 0.010 90);  /* #e5e3dc */
  --rule-faint: oklch(0.860 0.010 90);  /* #d3d1ca */
  --rule-mid:   oklch(0.640 0.014 90);  /* #8f8c83 */

  /* ink — three densities, hue 80 */
  --ink-ghost:  oklch(0.530 0.014 80);  /* #706b63 */
  --ink-2:      oklch(0.460 0.018 80);  /* #5d574d */
  --ink:        oklch(0.250 0.020 80);  /* #272117 */

  /* chart-pen red, hue 32 */
  --red-solid:  oklch(0.520 0.180 32);  /* #ba2e17 */
  --red-deep:   oklch(0.440 0.160 32);  /* #971d08 */
  --red-wash:   oklch(0.940 0.028 32);  /* #fde5e0 */

  /* drafting blue, hue 255 */
  --blue:       oklch(0.430 0.095 255); /* #285183 */
  --blue-wash:  oklch(0.945 0.018 255); /* #e5eef9 */
}
```

Only ramps the product renders: no warning/success hues exist. Abstention and
negative-control states are ghost ink plus a text label, never a new color.

### 2.2 Semantic tokens (the only tier components reference)

```css
:root {
  --color-bg-page:          var(--paper-0);
  --color-bg-figure:        var(--paper-1);   /* figure-box fill, table stripes */
  --color-bg-hover:         var(--paper-2);
  --color-rule:             var(--rule-faint); /* hairlines, table rules */
  --color-rule-strong:      var(--rule-mid);   /* figure-box borders */

  --color-text-primary:     var(--ink);
  --color-text-secondary:   var(--ink-2);     /* captions, suggest-band rows */
  --color-text-ghost:       var(--ink-ghost); /* dominated / below-threshold / abstained */

  /* invoke = the heaviest ink. Selection is the strongest statement on paper. */
  --color-invoke-ink:       var(--ink);      /* selected-row text and bar, solid + bold */
  --color-invoke-wash:      var(--paper-2);  /* selected-row background */

  /* red = the grader's pen. Only verification marks may use it. */
  --color-threshold:        var(--red-solid); /* the ruled cut line at t */
  --color-verify-ink:       var(--red-deep);  /* caught-decoy and missed-truth marks */
  --color-verify-wash:      var(--red-wash);  /* wash behind red-marked rows */

  /* blue = annotation. Only links and margin notes may use it. */
  --color-annotation:       var(--blue);
  --color-annotation-wash:  var(--blue-wash);
}
```

One color, one meaning: **red is the grader's pen** — the threshold cut line, a decoy
the judge correctly rejected, a truth skill the judge missed. Red marks *where the eval
bites*, never selection; a chosen skill is not an alarm. **Invoke is solid ink** (full
density, bold, on a `paper-2` wash) — the letterpress rule taken literally: states are
ink density, and selected is the heaviest overprint. **Blue is annotation** (links,
margin notes, footnote daggers). Bands and marks are never distinguished by color
alone — every one carries a text label (INVOKE / SUGGEST / — / MISSED / REJECTED).

Red-mark curation rule: red may only mark a row the eval *deliberately tested* — decoys
come from named data (synthetic: the highest-scoring same-family sibling variants of
the truth — look-alikes that actually competed — capped at the few highest; real: a
curated per-fixture decoy list, empty until authored), and
missed-truth marks come from the ground-truth set. Red never marks an inference, and
never floods: a mark that appears ninety times a figure grades nothing.

Fill discipline: as *action* emphasis, exactly one control per view gets a solid fill —
the replay control, in solid ink (never red; the grader's pen is not a button).

### 2.3 Measured contrast (WCAG 2.1, computed from the hex values above)

| Pair | Ratio | Verdict |
| --- | --- | --- |
| `--ink` on `--paper-0` | 14.87:1 | AAA |
| `--ink` on `--paper-1` | 13.76:1 | AAA |
| `--ink` on `--paper-2` (invoke rows) | 12.42:1 | AAA |
| `--ink-2` on `--paper-0` | 6.67:1 | AA (AAA large) |
| `--ink-ghost` on `--paper-0` | 4.93:1 | AA |
| `--ink-ghost` on `--paper-1` | 4.56:1 | AA |
| `--red-solid` on `--paper-0` | 5.61:1 | AA |
| `--red-solid` on `--paper-1` | 5.19:1 | AA |
| `--red-deep` on `--paper-0` | 7.85:1 | AAA |
| `--red-deep` on `--paper-1` | 7.26:1 | AAA |
| `--red-deep` on `--red-wash` | 7.00:1 | AA (AAA large) |
| `--red-solid` on `--red-wash` | 5.00:1 | AA |
| `--blue` on `--paper-0` | 7.54:1 | AAA |
| `--blue` on `--blue-wash` | 6.91:1 | AA |
| `--rule-mid` on `--paper-0` | 3.13:1 | ≥3:1 non-text ✓ |

Every text token passes AA on every ground it is allowed to sit on — including ghost
ink, deliberately held at the readable floor so even dominated rows stay legible (the
number is the product). Any new pair must be measured before it ships; do not eyeball.

## 3. Type

Two faces, both from the report tradition, loaded as woff2 with `font-display: swap`:

- **Archivo** (variable: wght + wdth) — the report's *structure* voice: masthead,
  FIG./TABLE heads, labels, prose. Grotesque in the technical-manual lineage; the wdth
  axis gives the expanded report-cover register without a second family.
- **Courier Prime** — the *evidence* voice: every recorded number, skill name, receipt
  caption, and code literal. Typewriter mono is how reports set what the instrument
  said; monospacing aligns 48-row probability columns for free. Recorded data is never
  set in Archivo — the face split IS the honesty split.

Fallbacks: `Archivo, system-ui, sans-serif` · `"Courier Prime", ui-monospace, Menlo, monospace`.

### Scale (px / line-height)

| Role | Face | Size | Notes |
| --- | --- | --- | --- |
| Report masthead | Archivo 600, wdth 125 | clamp(28px, 4.5vw, 40px) / 1.1 | caps, letter-spacing 0.02em |
| Section head (`FIG. 1 — REAL CATALOG, 48 SKILLS`) | Archivo 600 | 13px / 1.3 | caps, letter-spacing 0.08em |
| Abstract / prose | Archivo 400 | 16px / 1.6 | measure ≤ 68ch |
| Table data (probabilities, skill names) | Courier Prime 400 | 14px / 1.5 | numbers align by monospace |
| Emphasized datum (selected p) | Courier Prime 700 | 14px / 1.5 | weight, not size |
| Head stamp date | Courier Prime 400 | 12px / 1.5 | `--color-text-secondary`; stamp label in Archivo 500 11px caps ghost |
| Figure axis / band labels | Archivo 500 | 12px / 1.3 | caps, letter-spacing 0.06em |

Hierarchy comes from caps, rules, numbering, and ink density — not from oversized
display type. Probabilities print with two decimals always (`0.90`, `0.05`); a column
of ragged precision reads as sloppiness in this world. Prose blocks wrap with
`text-wrap: pretty` and hold the 68ch measure — the measure is load-bearing (return-sweep
readability at the 960px column), never dropped to fill the white space, which is the
report's notes-column look working as intended.

## 4. Motion

Two clocks, never mixed:

### The recorded clock (replay — the signature interaction)

- Drives every data event: judge fills, threshold strokes, shard fan-out, phase
  transitions. **Durations come from the fixture JSON** (`latencyMs`, per-run), never
  from taste. A visible ms counter runs during replay and lands on the recorded total.
- **The judge wave:** the probability column fills top-down as one traveling wave;
  per-row delay = `latencyMs / judgedCount`, each row's own print-in is 140ms
  ease-out (opacity 0→1 + translateY(4px)→0). Total wall time = recorded total.
- **The guidelines and their order.** Both policy guidelines — suggest (gray) and
  invoke (red) — are single continuous vertical rules spanning the ranked column,
  identical in weight and treatment (1.5px), peeking a few pixels past the column's
  top and bottom (a plot guideline, not a container edge) while stopping clear of
  any prose lines; never per-row segments. They
  draw via `clip-path: inset()` reveal, linear easing (pen speed is constant). The
  recorded latency IS the whole timeline: row delays are exact truth, and every
  presentation event fits inside the window at proportional times (suggest stroke
  ~45%, invoke ~60%, band labels stamping from ~80% to the edge; print tails clip
  at the boundary). Nothing animates past the measurement, so a scrubber over the
  timeline reads 0 → recorded total edge to edge, counter equal to thumb.
- **Numbers stamp, never tick.** A probability appears whole; count-up tickers fake a
  precision the instrument never had.
- Implemented with WAAPI (`element.animate`) so the whole replay is one scrubbable,
  pausable timeline: play/pause/scrub is the primary control; scrubbing sets state
  directly with no easing. Replay is interruptible at any frame.

### The interface clock (chrome — Emil's rules)

- Easing: `--ease-out: cubic-bezier(0.23, 1, 0.32, 1)` for enter/exit,
  `ease` for hover color, linear only for constant motion. Never `ease-in`.
- Durations: press feedback 120ms, hovers 150ms, row-state changes 160ms, figure/tab
  transitions 200ms. Nothing over 250ms on this clock.
- Transitions over keyframes everywhere state can retrigger (fixture switching) so
  motion retargets instead of restarting.
- Pressables get `transform: scale(0.97)` on `:active`; nothing enters from
  `scale(0)`; only `transform` and `opacity` animate; hover effects gated behind
  `@media (hover: hover) and (pointer: fine)`.
- Keyboard-driven fixture cycling gets **no** transition — the new figure stamps in.
- State changes are ink-density steps (color transition, 160ms `ease`), not fades to
  gray; a row changing band changes density, it does not slide.

### Reduced motion

`prefers-reduced-motion: reduce` renders every figure in its final state immediately;
recorded timings remain visible as printed numbers in the closing conclusion ("judged 48
skills in 741 ms"). Opacity-only fades ≤200ms may remain. The honesty survives without
the motion because the conclusions carry it.

## 5. Layout & components

- **Page:** single centered report column, `max-width: 1008px` (960px content inside
  24px pads — the figure-dominant page earns the former full-bleed width), generous
  top margin; prose blocks hold a 68ch measure inside it. Spacing on an 8px rhythm;
  more space above a section head than below it.
- **Figure box:** 1px `--color-rule-strong` border, `--color-bg-figure` fill, head
  top-left, blue conclusion annotation bottom, hairline column rules inside.
  Heads carry identity plus provenance and nothing else — the short caps title on
  the left, the recorded stamp on the right edge (caps `recorded` label + mono
  date). Subtitles are retired; framing prose belongs in the figure note. No chrome
  text, no controls. Instrument controls live in the section body: FIG. 0's
  replay/scrub under its chart, FIG. 2's replay at the end of the tabs row. FIG. 1
  carries no replay button; a pointer tab switch replays its chart.
- **The mechanism figure:** one real recorded turn (default: `a11y-widget`), no
  numbered steps and no caption prose — the artifact sequence speaks: the prompt,
  the chart replaying truth-timed, the replay/scrub controls with the ms counter
  directly beneath the chart they drive (the counter lands on the recorded total),
  and the verdict as the terminal prints it — elbow glyph, muted, matching the
  opener's transcript styling. The head carries no subtitle — dot-separated quick
  hits are banned chrome. The three mechanism claims (one Noul per skill,
  independence, tunable policy) live in a blue `.annotation` closing the figure,
  one sentence each, pointing at the artifacts that prove them.
  The scrubber knob is square — paper and square edges, no pill chrome.
- **Row anatomy (the core unit):** skill name (mono) · probability bar as a horizontal
  ink stroke scaled to p · printed value (mono, 2 decimals) · band label. Selected rows:
  `--color-invoke-wash` background, solid `--ink` bar and bold text. Suggest band:
  `--ink-2`. Dominated/below: `--ink-ghost`. Red verification marks override the band's
  ink: a **missed truth** (ground-truth skill below the cut) and a **caught decoy**
  (named look-alike correctly rejected) render in `--color-verify-ink` with their label.
  The red threshold rule crosses the whole figure at t=0.85 — the shipped default —
  with its value tagged on the axis. Rows disclose their skill description on click
  (progressive disclosure — routing itself only ever saw name+description, so showing
  it is honest). Long names truncate with an ellipsis inside their own span; footnote
  marks and the rank prefix sit outside it and never clip.
- **FIG. 1's worked example:** the `build-animation` / `holistic-review` pair is the
  featured comparison — direction discrimination (orchestrator 0.07 ↔ 0.96) beside
  same-territory co-invocation — captioned with the control story: co-invocation is
  the router *reporting* measured overlap and erring toward it is the designed
  default (better observed outcomes, priced in tokens); the doctor names the overlap
  at its source (TABLE 3 carries the duplicate twins that both fire 0.97 here), and
  `exclude` / "Not for" clauses / `threshold` are the user's dials.
- **Two bands, two speech acts.** The invoke band is a command; the suggest band is a
  menu (verified live: models obey the first wholesale and consult the second exactly
  when needed). The figure must render that difference: INVOKE rows in solid ink on
  wash, SUGGEST rows in `--ink-2` with their label always printed — legible as
  *sanctioned but optional*, never as failure or dimmed noise. Every figure and
  caption names both bands; a verdict with an empty invoke list and populated
  suggests is captioned as a healthy shape, not an abstention.
- **Footnote marks and legend:** `†` = ground truth, a *set* — every member carries the
  dagger, wherever it ranks; `‡` = curated decoy. Every figure that uses a mark prints
  a legend line naming it; the legend holds only row-mark lines and hides when empty.
- **The fixture-type label.** Above the rows (between query and chart) each eval
  fixture carries a caps tag plus one defining sentence, so the case type reads next
  to the data it describes and survives tab switching. The label set is exactly two:
  `EXPECTED INVOKE` (ground truth present — † defined as the skill each part of the
  ask can't do without, the invoke expectation, and other fitting skills welcomed as
  ungraded co-invokes) and `NEGATIVE CONTROL` (truth exists only in the other catalog,
  or is installed but outside the routable catalog — names the true skills and
  captions abstention as the correct outcome). The tag is a bordered ink
  chip; the sentence stays sentence-case prose. Nothing the label says repeats in
  the legend.
- **Language rule:** "51" is the *installed* catalog — labels always say "installed
  skills" for the real catalog and "synthetic org" for the ~1,064; the two worlds are
  never described by a bare count.
- **The separator rule.** A dot separator may join only short, same-kind facts that fit
  on one line (the masthead series line passes). Three or more unrelated concerns, or
  any chain that wraps, is a structure failure: give each concern its own line, labeled
  pair, or grid cell — statements get room to breathe, and mixed kinds (a count, a
  policy value, a claim) never share one muted run-on.
- **Figure head anatomy.** Short caps title (≤ ~20 characters: MECHANISM, CATALOG,
  SCALE, DOCTOR) on the left, the recorded stamp on the right — no subtitle.
  No number chips: this is a demo, not a paper; cross-references use section names
  ("see Doctor"), never figure numbers. Long uppercase runs are banned — caps kill
  word shape past a label's length.
- **Every section closes in the annotation voice.** The mono receipt with its rule is
  retired: each figure ends with a blue `.annotation` conclusion — scope and recorded
  cost in plain sentences plus at most one interpretive line, never a fragment chain.
  The recorded date lives in the head stamp, not the conclusion. Each zone has one
  job: figure chrome holds controls, notes hold one claim, the conclusion holds the
  closing sentences; every number appears on the page exactly once. Repo file paths
  and bench JSON names live in the colophon only; the conclusion proves the number,
  the colophon says where the bytes ship.
- **The threshold key:** the test strip is retired — three hypothetical exposures and
  a "shipped" tag confused more than they taught. Catalog instead closes its chart
  with the two recorded cuts restated as values in the guides' own colors (gray
  `suggest ≥ 0.80`, red `invoke ≥ 0.85`, from `DATA.policy`, never hardcoded), plus
  one line saying both are tunable settings and every verdict came from them. No
  alternative-threshold hypotheticals anywhere — only the data from recorded runs.
- **Doctor findings (Table 3):** a ruled table of collisions/intrusions with margin
  annotations in blue; probe scores in mono.
- **Mobile (≤640px):** the report column becomes the viewport; figure boxes go
  full-bleed; the 48-row table keeps all rows (never truncate evidence) with the
  probability bar compressed before the name truncates. Controls stay ≥44px hit areas.
- No shadows, no rounded cards, no glassmorphism: depth is expressed by rules and
  fills, as print does it. Corner radius 0 on figure chrome; 2px max on small controls.

## 6. Voice

Report register, sentence case for prose, caps for structural labels. Say what was
measured, plainly: "judged 53 skills in 325 ms", "0 selected at t=0.85, the correct
abstention". Never marketing adjectives ("blazing", "accurate"); the numbers persuade
or nothing does. Misses are captioned as findings, not excused. Em dashes, colons, and
semicolons are BANNED from visitor-facing copy (titles, notes, legends, annotations,
captions, labels) — compose plain sentences instead, several short ones when needed.
All three marks remain legal in data artifacts quoted verbatim (terminal transcripts,
the signature line, CLI output), in data glyphs (the empty cell "—", the below-band
"—", `Invoke: [—]`), in en-dash ranges, and in code and this contract.

The opener leads with the example, not the claim: PROMPT (label + standard query
block), a schematic fork trace sending it into both panels — square-cornered
hairlines, no arrowheads, square pins plugged into each panel's top edge; stem and
rail neutral, left drop gray, right drop annotation blue, hidden when the columns
stack — then the TWO TERMINALS pair. The two annotations carry parallel empirical
takeaways, calibrated: stock skill use rides on the model; the routed verdict was
identical across every model tested and is decided before the model. Its variance
is stated as the measured magnitude (±0.01 run to run — confident calls hold, only
borderline scores can drift across a cut), never as the bare word "probabilistic",
which over-implies LLM-grade wobble. The left
(stock) panel is a slow ROTOR over model scenarios — same prompt, four RECORDED
stock outcomes (fable's native hit; sonnet, haiku, and opus each going in blind),
never invented transcripts, model name in the label ("· fable"), square dots as
the position cue, ~6s dwell, 120/180ms opacity fade on the interface clock, paused
on hover or focus-within, static under reduced motion. The right (routed) panel is
constant and labeled "any model": the recorded signature line and Skill() calls,
because the judgment does not change with the session model. Monochrome left, blue
right; annotations name the axis (fuzzy instinct varies by model vs. same typed
judgment always). The pair uses the fixture Mechanism replays, handing off into it.

---

*Direction locked 2026-09-21 (seed 47b0d8c4, assigned card, user-confirmed). Alternates
on file: recorded terminal cast (pick), risograph (competitive). At the finish review,
the documenter reconciles this file and `.impeccable/design.json` against the built
surface.*

*Revised 2026-09-22 (user-directed): FIG. 0 mechanism exhibit added and the abstract
demoted to three sentences; threshold corrected to the shipped 0.85 everywhere; the
suggest band made first-class (two bands, two speech acts); data references updated to
the fresh 53-skill recapture. Visual system (§2 color, §3 type) unchanged — still the
locked direction.*
