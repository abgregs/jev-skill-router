# CLI

Install the command first ([install → CLI](install.md#option-2-the-cli)).

## `jev-skill-router route`

Reads `<slug>/SKILL.md` skills from a directory and prints which the router would invoke.
It's provider-agnostic: skills follow the standard `npx skills` layout, so the default
catalog is the canonical store `~/.agents/skills`. Override with `--skills-dir` (e.g.
`~/.claude/skills`) or `SKILLS_DIR`.

```bash
jev-skill-router route "add a datadog dashboard for the payments rollback"
jev-skill-router route "..." --skills-dir ~/.claude/skills --threshold 0.8 --top 20
```

| Flag | Purpose |
|---|---|
| `--judge mock\|jev` | `jev` (default) needs a key; `mock` is a free keyword dry run. |
| `--threshold`, `--suggest-floor`, `--max-selected` | Override the [policy](configuration.md#keys) for this run. |
| `--exclude a,b` | Leave skills out of routing. |
| `--transcript` | Conversation text to judge as background, like the hook's transcript tail. |
| `--top N` | How many scored rows to print. |
| `--config PATH` | Use a specific config file. |
| `--json` | One machine-readable object (`{invoke, suggest, probabilities, ...}`) for host adapters. |

**Name and description only.** Routing decides on SKILL.md `name` + `description`, the real
Agent Skills routing surface under progressive disclosure, so no skill bodies are read. The
spec designates `description` as where a skill states what it does and when to use it, so
that field is the router's entire premise. A skill without one is left out of routing (the
[doctor](catalog-doctor.md) flags it as unroutable); Claude Code falls back to the body's
first line, but the router doesn't guess.

## npm scripts (from a clone)

```bash
npm run inspect     # pure-code smoke test: loader + synthetic catalog + mock pipeline
npm run bench       # scale benchmark: 1064 skills, sharded fan-out, threshold sweep
npm run typecheck

npm run route -- "..."             # same as jev-skill-router route
npm run doctor -- --no-probe       # free static catalog report
npm run doctor -- --dry-run        # project the cost of a probe sweep

npm run demo:data   # regenerate web/data/replays.json from fixtures/recordings/
npm run demo        # preview server for web/ (the page itself is static)

npm run route:live      # one fixture over the real catalog (needs a key)
npm run eval:capture    # real-Jev evals, writes recordings (needs a key)
npm run bench:session   # paired stock-vs-router sessions (needs a key, spends on both meters)
```

Evals and the demo data: [running evals](../evaluation/running-evals.md).
