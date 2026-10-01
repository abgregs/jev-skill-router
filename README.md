# jev-skill-router

A [Jev](https://typesafe.ai)-powered router that decides **which agent skills a coding
agent should invoke** for the current session — turning the model's fuzzy "should I use
this skill?" guess into typed, thresholdable probabilities that code can act on.

The problem: a coding agent (Claude Code, etc.) may have dozens — or, in a large org,
**thousands** — of local and global skills. Whether to fire one depends on the whole
session (latest query, open files, transcript, `CLAUDE.md` rules). That's genuinely
ambiguous — exactly the "programmable common sense" Jev is for.

## Install

Needs a TypeSafe API key. The router asks Jev about every routed skill on every prompt:
one Noul per skill per turn, so a 51-skill catalog spends 51 Nouls a prompt. Skills you
`exclude` are never judged and cost nothing.

In Claude Code, two commands (the repo is its own plugin marketplace):

```
/plugin marketplace add abgregs/jev-skill-router
/plugin install jev-skill-router@jev
```

Claude Code asks for the key when it enables the plugin and keeps it in your system's
credential store, not in `settings.json`; `/plugin configure jev-skill-router@jev` sets or
changes it later. An exported `TYPESAFE_API_KEY` also works and takes precedence. Without
a key, routing and the gate both stay off, and the router says so once per session.

That registers two hooks. Every prompt is routed against your installed skills *before*
the model sees the turn, and the verdict is injected into context ("Invoke: … / Also
relevant: …"); a gate then holds the routed skills to that list — fail-open, and skills
the router never judged pass untouched.

**To be sure a skill runs, slash-invoke it.** Typing `/git-commit` always gets it
through: the router adds it to the verdict and the gate lets it pass. Asking in words
("use the git-commit skill") is not the same. The router reads your prompt, so asking can
raise the skill's score, but the skill runs only if the verdict carries it or it's in
your `alwaysAllow` list; otherwise the gate turns the model's attempt away.

**Settings.** Routing works with no config file. To change it — `exclude`,
`alwaysAllow`, thresholds — write `.skillrouter.json` in the folder you start Claude Code
from, or `~/.skillrouter.json` for every project. This is the router's own file, not
Claude Code's `settings.json`; the first one found wins and the two don't merge.
`jev-skill-router config …` edits it (see the command below); plugin-only users edit it
by hand (see Config layering).

Requires Claude Code, the only supported host, and Node 20.12+ on your `PATH`: the hooks
run as `node` scripts in both install paths. Details and uninstall: see the Claude Code
hooks section below.

**The `jev-skill-router` command.** The plugin installs only the hooks. The command —
`config`, `doctor`, `route`, and `install claude` for a setup without the plugin — comes
from a clone; it isn't published to npm:

```bash
git clone https://github.com/abgregs/jev-skill-router
cd jev-skill-router
npm install && npm link    # puts jev-skill-router on your PATH
```

`npm link` installs the command for the active Node version; with nvm, switching versions
hides it until you run `npm link` again. `npm rm -g jev-skill-router` removes it.

## Architecture — judge everything, in parallel

```
session state  ──▶  1. JUDGE   (Jev)         one Noul per skill, sharded + parallel → p(0..1)
                    2. POLICY  (plain code)   threshold + rank → skills to invoke
```

Every skill in the catalog is judged, every time. No retrieval heuristics, no shortlist,
no index to go stale — the judgment layer sees the whole catalog, and plain code decides
what to do with the probabilities.

- **Why `Noul`, not `Choice`.** We want an *independent* probability per skill, and to
  select *several* at once. `Choice` picks one winner from a single distribution (and
  caps at 255 options). `Noul` gives each skill its own p(should invoke) — the number
  you threshold. See the TypeSafe docs.
- **Why judging everything stays fast.** Nouls are independent judgments: no skill ever
  needs to see another to be scored. So the catalog shards (250 Nouls per request by
  default) and the shards fan out concurrently via `Promise.all` — wall-clock ≈ the
  slowest single shard, not the sum. Measured with the live judge: **479–545ms over
  1,064 skills** (5 parallel shards) and 132–306ms over the real 51-skill catalog in a
  single request (see `fixtures/recordings/`). This is also what scales past the 255
  `Choice` cap: a Choice can't shard (shard winners would never meet), independent
  Nouls shard losslessly.
- **The cost model is exactly one Noul per installed skill per routing decision.**
  Latency flattens with parallelism; spend does not — it's linear in catalog size. The
  honest cost levers are catalog hygiene (`exclude`, the doctor below), not a lossy
  retrieval layer in front of the judge.

## Layout

```
lib/skills/   types · loadSkills (real SKILL.md) · synthesize (Uber-scale synthetic catalog)
lib/router/   route (shard + fan out + policy) · judge (interface) · mockJudge · jevJudge
              recordedJudge (replay captured runs) · policy
lib/doctor.ts catalog doctor: static findings + probe-driven overlap detection
fixtures/     labeled sessions with ground-truth skills · recordings/ (captured real-Jev runs)
bench/        scale benchmark over the 1,064-skill synthetic catalog
scripts/      cli — the one bin (route · doctor · install claude · config) · build — esbuild → dist/
              inspect — pure-code smoke test · eval-capture — real-Jev evals
dist/         committed dependency-free bundles: the npm bin + the plugin's hooks
web/          the recorded demo — a static page replaying captured real-Jev runs
```

The **mock judge** is deterministic and free; it validates the pipeline and the fan-out's
cost accounting, **not** Jev's real routing quality (it scores on keywords; Jev's edge is
semantic). The CLI and hooks run it only when asked for by name (`--judge mock`, or
`"judge": "mock"` in config); Jev is the default. The
**recorded judge** replays captured real-Jev results verbatim — it powers the demo and
fails loud rather than improvise.

## Run

```bash
npm install
npm run inspect   # pure-code smoke test: loader + synthetic catalog + mock pipeline
npm run bench     # scale benchmark: 1064 skills, sharded fan-out, threshold sweep
npm run typecheck

# route your REAL installed skills with Jev (needs a key; --judge mock is a free keyword dry run):
npm run route -- "add a datadog dashboard for the payments rollback"
npm run route -- "..." --skills-dir ~/.claude/skills --threshold 0.8

# catalog health report (static findings free; probes judge with Jev, --dry-run projects the cost):
npm run doctor -- --no-probe
npm run doctor -- --dry-run

# recorded web demo (static, no key):
npm run demo:data # regenerate web/data/replays.json from fixtures/recordings/
npm run demo      # preview server for web/ — the artifact itself is static

# real Jev judge (needs a key):
TYPESAFE_API_KEY=sk-... npm run route:live            # one fixture over the real catalog
TYPESAFE_API_KEY=sk-... npm run eval:capture          # real-Jev evals, writes recordings
```

### CLI — route real skills (`jev-skill-router route`)

Provider-agnostic: reads `<slug>/SKILL.md` skills from a directory and prints which the router
would invoke. Skills follow the standard `npx skills` layout, so the default catalog is the
canonical store `~/.agents/skills`; override with `--skills-dir` (e.g. `~/.claude/skills`) or
`SKILLS_DIR`. Flags: `--judge mock|jev`, `--threshold`, `--suggest-floor`, `--max-selected`,
`--top`, `--open-files a,b`, `--rules`, `--transcript`, `--config`, `--json`.
Routing decides on **name + description** only — the real Agent Skills routing surface
(progressive disclosure), so no skill bodies are read. This takes the convention at its
word: the spec designates SKILL.md frontmatter `description` as where a skill states what
it does and *when it should be used*, so that field is the router's entire premise. A
skill without one is left out of routing (the doctor flags these as unroutable); Claude
Code falls back to the body's first line, but the router does not guess.

**Policy: two bands and a cap.** Skills at `p >= threshold` (default **0.85** — recall-biased,
calibrated on the real-catalog fixtures; precision-minded hosts set 0.9) are **invoked**, capped
at `maxSelected` (default 6). Skills in `suggestFloor..threshold` (default 0.8) plus any
above-threshold overflow are **suggested** — surfaced by name only, which is nearly free under
progressive disclosure. On real catalogs the suggest band tends to hold secondary intents and
suite leaves dominated by an orchestrator skill.

**Config layering.** Options resolve as CLI flag > environment > config file > default. The
config file is `--config <path>`, else `.skillrouter.json` in the cwd, else
`~/.skillrouter.json` — any subset of `skillsDir`, `judge`, `threshold`, `suggestFloor`,
`maxSelected`, `shardSize`, `top`, `exclude` (skill ids removed from routing entirely — the
config expression of "I picked a favorite"), and the hook gate's `alwaysAllow`.

Edit the two lists with `jev-skill-router config` instead of by hand; plugin-only
installs have no command, so edit `.skillrouter.json` directly. `add` checks each id against the catalog the router
judges and writes nothing on a miss, so `exclude add docs` answers "did you mean
anthropic-skills:docs?"; `--project` targets `./.skillrouter.json`; `show` prints the
file in effect where you run it, flagging entries that name no routed skill.

```bash
jev-skill-router config exclude add anthropic-skills:docs
jev-skill-router config allow add anthropic-skills:pdf --project
jev-skill-router config exclude remove brief debrief
jev-skill-router config show
```

**`--json`** emits one machine-readable object (`{invoke, suggest, probabilities, ...}`) for
host adapters — e.g. a Claude Code `UserPromptSubmit` hook that injects the verdict each turn.

### Catalog doctor (`jev-skill-router doctor`)

Is the catalog healthy *as a routing surface*? Everything the doctor grades is the surface
the router runs on — SKILL.md frontmatter `name` + `description`, the fields the Agent
Skills convention designates for what a skill does and when to use it — so every finding is
a statement about those fields. The doctor prints a short report where every finding names
its evidence and exactly one action — "uninstall X", "add a 'Not for Y' clause to Z's
description", "add W to exclude" — never a wall of similarity scores.

**Static findings** are free plain code over name+description keywords: near-verbatim
**duplicates** (in the tested catalog, `better-ui` ≡ `make-interfaces-feel-better` at
keyword Jaccard 0.62, a legacy rename — the next-closest pair sits at 0.33), **unroutable**
folders (no SKILL.md or no description; the loader silently skips these, the doctor
surfaces them — Claude Code's own `synced/` and dot-folders like `.trash` are not
skills and are ignored), **weak** routing surfaces (too few keywords to fire on anything but exact
wording), and **stale** `alwaysAllow`/`exclude` entries naming uninstalled skills.

**Overlap findings come from probes, not similarity.** Each skill's description is
task-framed ("my current task is squarely the kind of work this covers: …") and routed as
a session against the whole catalog: co-invocation on a skill's home territory is
*measured routing confusion* under the configured threshold. Similarity can't do this job —
measured on the real catalog, the umbrella overlap between `impeccable` and
`web-design-guidelines` peaks at 0.39 keyword containment, lexical noise. Probe verdicts:

- **collision** — mutual: each fires on the other's territory (real catalog:
  `prototype ↔ variant` at 0.95 both directions). Same job, different authors; only user
  preference resolves it → keep your favorite, add the rest to `exclude`.
- **overlap** — one-way: an intruder fires on a specialist's territory while the
  specialist stays scoped at home (real catalog: `impeccable` fires on 7 specialist
  territories) → add a "Not for …" clause to the intruder's description.
- **self-miss** — the router won't invoke a skill even on a task built from its own
  description. That probe is an unusable instrument, so it contributes **no** overlap
  conclusions (gating, not punishment); the finding is "rewrite, then re-probe with
  `--only <ids>`".

Suites are exempt from overlap findings: same-prefix families (`better-*`) and skills
whose descriptions cross-reference each other encode an author-designed hierarchy the
router already routes correctly (see the finding above) — co-firing inside one is the
author's design, not a fault. `alwaysAllow` skills are likewise exempt as intruders: the
user already decided they ride along.

Probes judge with Jev by default, which is what finds semantic overlap; `--judge mock`
probes are free but see only lexical confusion. Each probe judges the whole catalog, so
cost is probes × catalog size — projected before spending (53 skills → 2,809 Nouls for a
full sweep) and refused past `--max-nouls` (default 3000). Without a key, a plain run
reports the static findings and says the probes were skipped. `--no-probe` gives the
always-free static report, `--dry-run` prints the projection, `--json` a machine-readable
report.

Paid sweeps never evaporate: jev runs auto-record raw probe probabilities (no threshold
baked in) to `fixtures/recordings/doctor-probes.json`, `--only` re-probes merge into the
file, and `--replay <path>` re-runs the whole interpretation — any `--threshold` —
against the capture with zero API calls. Each recorded probe snapshots the descriptions
it judged, so replay warns per-probe when an edit has made its probabilities stale
(dev/eval tooling for iterating on the doctor, not a shipped feature).

The boundary, stated honestly: cross-author umbrella overlap can't be auto-fixed —
`impeccable` and the review-oriented skills all legitimately claim broad territory. The
doctor surfaces the collision with measured probabilities; the resolution is the user
picking a favorite, which is exactly what `exclude` expresses (honored by `route-cli` and
therefore by the hooks; the gate denies excluded skills unless you slash-invoke them).

### Claude Code hooks — take skill selection off the main agent (`hooks/`)

Two hooks make the router authoritative in a Claude Code session:

- **`hooks/user-prompt-submit.ts`** (the routing seat) — fires before the model sees the
  turn, routes the prompt + recent transcript in-process, persists the verdict to a
  session-keyed state file, and injects "Invoke: … / Also relevant: …" into context.
  The skill decision is made before the agent starts thinking. Any catalog skill the
  user slash-invoked (`/improve-animations …`) is **promoted into the invoke band with
  certainty** — past the judge's score and the cap — so the instruction the model reads
  matches what the user commanded. Silent on conversational turns; on an error it shows
  you a one-line notice and never breaks the turn.
- **`hooks/pre-tool-use-gate.ts`** (enforcement) — matched on the `Skill` tool; denies
  invocations of routed skills that are not on the turn's approved list, and of skills
  the config excludes, so the agent's native instinct to pick its own skills has no effect. **Fail-open** (no/stale state →
  allow): routing is a policy layer, not a security boundary. Always allowed: skills the
  user typed as a slash command (`/git-commit`, `/anthropic-skills:pdf`, or the base
  `/name` of a namespaced skill), the config's `alwaysAllow` list, and any skill the
  router did not judge. Only a slash command counts as your say-so: a skill you ask for
  in prose ("use the git-commit skill", "update our docs") runs only if the verdict
  carries it or it's in `alwaysAllow`; otherwise the gate denies the model's call.

**What gets routed.** The routed catalog is what Claude Code loads at session start:
personal `~/.claude/skills`, the project's `.claude/skills` from the session directory up
to the repository root (a personal skill shadows a same-named project skill, as in Claude
Code), and skills synced from claude.ai (`~/.claude/skills/synced/`), routed as
`anthropic-skills:<name>`. Skills outside it — bundled, plugin-provided, nested below the
session directory, from `--add-dir`, managed, or without a `description` — are never
judged, and the gate lets them through untouched.

**Keeping a routed skill always callable (`alwaysAllow`).** The gate denies a routed
skill that missed the turn's verdict, even when the need only shows up mid-turn. Ask
"pull the revenue table out of the board deck in `./reports/` into a spreadsheet" and the
verdict may carry `anthropic-skills:xlsx` but not `anthropic-skills:pdf`, because nothing
in the prompt says PDF. When the agent opens the deck, finds a PDF, and reaches for the
pdf skill, the gate denies it. List the skill in `alwaysAllow` and that call passes:

```json
{ "alwaysAllow": ["anthropic-skills:pdf", "git-commit"] }
```

or `jev-skill-router config allow add anthropic-skills:pdf git-commit` (see Config
layering).

Use the routed id. Synced skills are `anthropic-skills:<name>`, and that entry passes a
call by either the full name or the short `pdf`; a bare `"pdf"` only matches calls made
by the short name, and names your local `pdf` skill if you have one. `alwaysAllow` only
unblocks: it never adds the skill to the verdict or tells the agent to use it, and the
router still judges it every turn. What you give up is enforcement for that skill: the
agent can load it on turns that don't need it, spending context. It fits utility skills
that act on file types a prompt may not name, and process skills your standing
instructions require (`git-commit` above). The gate reads the first config it finds —
the project's `.skillrouter.json`, else `~/.skillrouter.json` — so a project file
replaces your home list rather than adding to it.

**Install — the plugin (recommended).** The repo is a Claude Code plugin and its own
marketplace; the hooks ship as committed, dependency-free bundles (`dist/`), so there is
no settings.json editing and no path to go stale:

```
/plugin marketplace add abgregs/jev-skill-router
/plugin install jev-skill-router@jev
```

`/plugin uninstall jev-skill-router@jev` removes it.

**Install — the CLI (hooks written into settings.json).** With the command linked (see
Install), `jev-skill-router install claude` writes the hook registration into `~/.claude/settings.json` (`--project` for the
project file) with resolved absolute paths to the bundles. It is idempotent: any existing
router entries — including stale paths from a previous clone — are replaced, and
`--uninstall` removes them cleanly. The hooks run from the clone, so keep it in place:

```bash
jev-skill-router install claude          # or --dry-run to preview the settings diff
```

For local plugin development, `claude --plugin-dir /path/to/jev-skill-router` loads the
working tree as the plugin; `/reload-plugins` picks up a rebuild without restarting.

The hooks read the *project's* `.skillrouter.json` (threshold, `exclude`, `alwaysAllow`,
…) in the folder Claude Code was started from (parent folders aren't searched), else
`~/.skillrouter.json`; a project file replaces the home file rather than merging with
it. The key comes from an exported `TYPESAFE_API_KEY`, else the plugin's stored key,
else, for a clone install, the clone's `.env.local`. With no key the hooks stay off and say so once per session; any other
routing failure is reported on its turn, and the gate lets that turn through.

### Finding: hierarchies are read from descriptions — and shared territory co-invokes

Real catalogs contain **skill suites** — related skills by one author where an orchestrator
routes to domain leaves. In the tested catalog, `better-interface` describes itself as the
orchestrator over the `better-*` leaves ("holistic review rather than a single domain");
the leaves scope themselves to one domain each. Nothing in the router knows this structure —
no metadata, no naming heuristics; the hierarchy exists only in the descriptions. Two
real-Jev fixtures (recaptured 2026-09-28, 51-skill catalog, shipped `currentRequest`
judge framing) show what the router reads:

- **Direction discrimination is sharp, both ways.** On a single-domain build task
  (`build-animation`) the orchestrator stays home at **0.07** while the domain skills
  fire at 0.91–0.97; on the holistic ask (`holistic-review`) the same orchestrator
  scores **0.96** and the off-domain leaf (`animate`) sits at **0.03**. The hierarchy's
  *direction* is read from descriptions alone.
- **Skills sharing the asked-about territory co-clear the bar.** On the holistic ask,
  orchestrators and query-named leaves land at 0.87–0.98 and co-invoke up to
  `maxSelected`; the 0.80–0.85 shoulder (`better-typography` 0.80) lands in the suggest
  band, with `better-colors` just under the floor at 0.79. An earlier judge framing
  consolidated this shape (leaves dominated below threshold); the shipped `currentRequest` framing — adopted
  because it survives mid-session topic switches (see the transcript-weighting finding)
  — judges each skill against the current request alone, and genuine same-territory
  relevance now reads as several independent honest yeses.

This is the recall-biased posture the next finding documents as *desirable*: co-invocation
is the router reporting real catalog overlap, and on real artifacts it improved output.
The control surface is explicit, and the doctor names the overlap at its source — on this
exact territory it flags `better-ui ≡ make-interfaces-feel-better` as a near-verbatim
duplicate (both fire 0.97 on the build task) and `impeccable` as an umbrella intruder —
while `exclude`, "Not for …" description clauses, and `threshold` tune the rest. The
ceiling of all this is description quality: a suite whose author writes no disambiguation
clauses gives the judge nothing to read.

### Finding: co-invoking overlapping skills improved output — and the bands make it a dial

When several same-domain skills clear the invoke threshold together, the observed effect
on real artifacts was **better work, not noise**. In live A/B sessions, the arm that
loaded four "extra" design skills alongside `animate` shipped a toast with textbook motion
craft the single-skill arm lacked (asymmetric 250ms exit, shortened travel); the arm whose
verdict invoked the full design family ran the orchestrator's complete method (a 204-line
design doc with philosophy, tokens, type, and motion) where the stock session wandered for
76 seconds and never wrote the doc at all. Co-invocation is the router *reporting* genuine
catalog overlap, and — at least with a strong session model synthesizing them — that
overlap compounds instead of colliding. The cost is tokens (~2k per loaded SKILL.md).

The posture is deliberately recall-biased and **entirely tunable**: `threshold` sets the
invoke bar (0.85 default; 0.9 for precision-minded hosts), `suggestFloor` the
surfaced-not-invoked band beneath it, `maxSelected` caps crowding, and `exclude`/
`alwaysAllow` hard-wire the edges. If co-invocation ever degrades output, the remedy
ladder is: run the doctor (overlap is usually a catalog fault — add "Not for Y" clauses
or uninstall the redundant twin), then tighten thresholds. One compliance nuance:
obedient models load the verdict's full invoke list; lazier ones cherry-pick — so
verdict breadth is a real dial, not a suggestion, on frontier models.

### Finding: invoke is a command, suggest is a menu — and models treat them that way

The two bands turn out to carry two different speech acts, verified live (with a
frontier session model). The **invoke band is obeyed wholesale**: a compliant model
loads every commanded skill. The **suggest band is consulted, not obeyed**: forced
suggest-only verdicts (threshold set above 1.0 so nothing could reach the invoke bar)
showed the model taking exactly the one task-central suggestion per session — sometimes
as its literal first action, sometimes mid-turn after exploring the code — and ignoring
the co-suggested family every time. Across all recorded sessions the model draws from
the suggest band only when the invoke band hasn't already covered the need.

Two consequences. **An empty invoke list with populated suggests is a healthy verdict
shape**: the model works the task normally and retains sanctioned access to the whole
suggest band (the gate approves it), pulling in a suggestion exactly when needed — this
is the router's designed channel for needs that only emerge mid-turn. The shape to watch
is the *fully* empty verdict, where the gate denies every routed skill; that regime is
where fail-open policy matters. And practically: `threshold`/`suggestFloor` don't just
tune what gets selected — they tune **how imperatively the model is addressed** about
each skill, which is a control surface stock skill selection doesn't have at all.

### Finding: verdicts must weight the current request over the transcript

Single-turn evals structurally cannot catch this class of failure. The same two prompts
that routed perfectly in every single-turn bench rep (3/3 each) returned **empty or
suggest-only verdicts** when issued mid-session, after unrelated tasks — the judge's
transcript tail, dominated by the *previous* task, drowned out the topic switch. The
failure was reproduced deterministically off-line: replaying the identical prompts
through `route-cli` with the live session's reconstructed tails flipped the verdicts
exactly as observed; with a clean tail they routed fine. Worse, the enforcement gate
turned the judge's miss into a session loss — it denied the agent's own *correct*
instinct against the empty verdict.

The fix is in how the judge input is framed, not in dropping context: the session state
names the latest query `currentRequest` and the tail `earlierConversationBackground`,
and each Noul judges "against the current request alone" with the background explicitly
marked as possibly-finished prior work. Re-tested live across a five-prompt session with
two hard topic switches: every expected skill routed (2.4–3.1s to first skill on the
previously-failing turns), zero gate denials, and the conversational control turn
correctly routed nothing. The general lesson for anyone evaluating a router: **your
bench must include multi-turn sessions**, because first-turn accuracy says nothing about
survival after a topic switch.

### Real evals (`npm run eval:capture`)

Runs the labeled fixtures with the **real Jev judge** — every skill judged, one Noul each —
and captures the full probability maps to `fixtures/recordings/*.json`. Two catalogs:

- **real** (the author's user-routable installed skills, 51) — the quality anchor: curated ground truth,
  precision/recall per fixture, and negative controls (out-of-domain queries where the only
  correct outcome is abstention — reported as abstention, never as P/R/F1).
- **synthetic** (1,064 skills, an org-scale catalog of confusable near-siblings) — the
  scale story: 5 parallel shards, ~0.5s wall-clock, correct picks among 20+ same-family
  look-alikes.

Cost is real (one Noul per judged skill): synthetic runs are ~1,000 Nouls *per fixture*, so
the script projects spend up front and refuses to exceed `--max-nouls` (default `2000`) unless
raised. Scope with `--catalog real|synthetic|both`, `--fixtures <id,…>`, or preview with
`--dry-run`. The key is read from the environment or `.env.local` (git-ignored, loaded only
if not already set).

These recordings are the demo's entire data source: `npm run demo:data` replays every
capture through the real `route()` + policy code and writes `web/data/replays.json`; the
page just renders it. No key, no API, deterministic — displayed latencies and shard counts
are the capture's own, never faked.
