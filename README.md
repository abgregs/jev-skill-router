# jev-skill-router

**Per-turn skill routing for Claude Code.** A [Jev](https://typesafe.ai)-powered router that
scores every skill against every prompt, turning the model's hidden "should I use this
skill?" judgment call into probabilities that code can act on.

[Demo](https://abgregs.github.io/jev-skill-router/) · [Install](#install) · [Why](#why) ·
[How it works](#how-it-works) · [Everyday use](#everyday-use) ·
[Configuration](#configuration) · [Results](#results) · [Docs](docs/README.md)

[![The recorded demo: one prompt, run as a plain coding agent and with jev-skill-router](docs/assets/demo.png)](https://abgregs.github.io/jev-skill-router/)

**[Open the recorded demo →](https://abgregs.github.io/jev-skill-router/)** Real Jev runs
over a real 51-skill catalog, replayed in the browser. No key needed.

## Install

> [!NOTE]
> **Requires** Claude Code, Node 20.12+ on your `PATH`, and a TypeSafe API key.

To install, run:

```
claude /plugin marketplace add abgregs/jev-skill-router
claude /plugin install jev-skill-router@jev
```

In the Claude Code desktop app or an already open Claude Code session, run:

```
/plugin marketplace add abgregs/jev-skill-router
/plugin install jev-skill-router@jev
```

Enter your TypeSafe key when Claude Code asks; it's kept in your system's credential store.
From then on, every prompt is routed before the model sees it.

> [!TIP]
> **Cost:** one Noul per routed skill per prompt (51 skills = 51 Nouls). Excluded skills are
> never judged and cost nothing.

CLI install, the key lookup order, uninstalling, and local development:
[install guide](docs/guide/install.md).

## Why

| | Claude Code | Jev Skill Router |
|---|---|---|
| **CONTROL** | Absolute switches: `disable-model-invocation` and `user-invocable` flags, allow/deny, path globs, set once per skill. | Per prompt: every skill is scored against what you just asked, and you set the thresholds. |
| **RELEVANCE** | None of the switches look at your prompt; the model decides alone. | Jev measures each skill's description against the prompt, so the query decides. |
| **VISIBILITY** | Nothing records why a skill fired, and a skill that should have fired leaves no trace. | Every skill gets a score. `jev-skill-router route` shows them, so you can see why a skill missed. |
| **ENFORCEMENT** | The model can invoke any allowed skill at any point. | A gate holds the model to the verdict and the skills it loads call for, and a slash command always gets through. |
| **SCALE** | The lack of control persists and grows more unwieldy with every skill you add. With many skills, Claude Code even trims descriptions to fit its context budget. | Write clear descriptions instead of managing switches. Every skill is judged in parallel, at any catalog size. |

## How it works

Before the model sees your prompt, Jev scores every skill against it. Plain-code thresholds
turn those scores into a verdict that is added to the model's context, and a gate holds the
model to it.

- **What Jev reads:** your prompt, with the last ~2,000 characters of conversation as
  background, against each skill's name and description. Not `CLAUDE.md`, open files, or
  tool output.
- **Two bands:** skills at 0.85 or above are invoked (up to 6); skills from 0.80 to 0.85 are
  suggested by name for the model to use if a need shows up.
- **The gate:** denies routed skills that aren't on the turn's list. It fails open: a
  relevance filter, not a lock.
- **Fast at any size:** every skill is judged in parallel. Recorded runs: 51 skills in
  121–270ms, 1,064 in about half a second.

Details: [how routing works](docs/architecture/how-routing-works.md) ·
[Claude Code hooks](docs/guide/claude-code-hooks.md).

## Everyday use

| I want to… | Do this |
|---|---|
| Make sure a skill runs this turn | Slash-invoke it: `/git-commit`. |
| Keep a skill callable every turn (e.g. one your `CLAUDE.md` requires) | Add it to `alwaysAllow`. |
| Never route a skill | Add it to `exclude`. It's never judged and costs nothing. |
| Get fewer or more skills per prompt | Raise or lower `threshold` (0.85), or change `maxSelected` (6). |
| Find duplicate or overlapping skills | Run the [catalog doctor](docs/guide/catalog-doctor.md). |
| See what the router would pick | `jev-skill-router route "<prompt>"` ([CLI](docs/guide/cli.md)). |

> [!IMPORTANT]
> Asking for a skill in words ("use the git-commit skill") doesn't guarantee it runs. It can
> raise the skill's score, but only a slash command or `alwaysAllow` gets it past the gate.

## Configuration

Routing works with no config file. To tune it, write `.skillrouter.json` in the folder you
start Claude Code from, or `~/.skillrouter.json` for every project.

```json
{
  "threshold": 0.85,
  "exclude": ["debrief"],
  "alwaysAllow": ["git-commit", "anthropic-skills:pdf"]
}
```

| Key | Default | Purpose |
|---|---|---|
| `threshold` | `0.85` | Invoke bar. Set `0.9` for precision. |
| `suggestFloor` | `0.8` | Bottom of the suggest band. |
| `maxSelected` | `6` | Most skills invoked per prompt. |
| `exclude` | `[]` | Skills removed from routing. |
| `alwaysAllow` | `[]` | Skills the gate always lets through. |

> [!WARNING]
> The first file found wins and files don't merge: a project `.skillrouter.json` replaces
> your home file, lists included.

All keys, file precedence, and the `config` command: [configuration](docs/guide/configuration.md).

## Results

> [!IMPORTANT]
> These are the only routing-quality numbers the repo claims: 44 recorded runs on the
> released router, captured 2026-10-01 on a real 51-skill catalog, judged on the same inputs
> the plugin sends.

| Check | Result |
|---|---|
| Needed skills invoked (11 tasks) | **13 / 13** |
| User-only skill left alone | **1 / 1** |
| Off-catalog asks with no stand-in invoked | **5 / 5** |
| Prompts needing no skill with nothing invoked | **27 / 27** |

- The top-scoring skill landed at 0.97–0.99 on every task; on the off-catalog asks, the best
  wrong candidate topped out between 0.29 and 0.61.
- Small, single-turn, and labeled by us: evidence, not a benchmark.

Full breakdown and caveats: [results](docs/evaluation/results.md).

## Documentation

| Section | Pages |
|---|---|
| **Guide** | [Install](docs/guide/install.md) · [Configuration](docs/guide/configuration.md) · [Claude Code hooks](docs/guide/claude-code-hooks.md) · [CLI](docs/guide/cli.md) · [Catalog doctor](docs/guide/catalog-doctor.md) |
| **Architecture** | [How routing works](docs/architecture/how-routing-works.md) · [Repo layout](docs/architecture/repo-layout.md) |
| **Evaluation** | [Results](docs/evaluation/results.md) · [Running evals](docs/evaluation/running-evals.md) |
| **Findings** | [All findings](docs/findings/README.md) |

### Findings

| # | Finding | Evidence |
|---|---|---|
| [0001](docs/findings/0001_hierarchies-read-from-descriptions.md) | Skill hierarchies are read from descriptions alone; skills sharing the ask co-invoke. | Recorded runs |
| [0002](docs/findings/0002_co-invocation-improved-output.md) | Co-invoking overlapping skills improved output. | Development |
| [0003](docs/findings/0003_invoke-is-a-command-suggest-is-a-menu.md) | Models follow invoke wholesale and consult suggest when needed. | Development |
| [0004](docs/findings/0004_weight-current-request-over-transcript.md) | Weight the current request over the transcript; bench multi-turn. | Development |

## Development

<details>
<summary>Run it from a clone</summary>

```bash
git clone https://github.com/abgregs/jev-skill-router
cd jev-skill-router
npm install && npm link    # puts jev-skill-router on your PATH

npm run inspect     # pure-code smoke test (mock judge, no key)
npm run typecheck
npm run demo        # recorded web demo, no key
```

More scripts: [CLI](docs/guide/cli.md#npm-scripts-from-a-clone) ·
[running evals](docs/evaluation/running-evals.md) ·
[repo layout](docs/architecture/repo-layout.md).

</details>

## License

[MIT](LICENSE)
