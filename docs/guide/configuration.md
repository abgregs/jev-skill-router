# Configuration

Routing works with no config file. To change it, write `.skillrouter.json` in the folder you
start Claude Code from, or `~/.skillrouter.json` for every project. This is the router's own
file, not Claude Code's `settings.json`.

## Keys

| Key | Default | What it does |
|---|---|---|
| `threshold` | `0.85` | Invoke bar: skills at or above it are invoked. Recall-biased; precision-minded hosts set `0.9`. |
| `suggestFloor` | `0.8` | Skills between this and `threshold` are suggested by name, not invoked. |
| `maxSelected` | `6` | Cap on invoked skills per prompt; overflow drops to suggest. A bloat guard, not a tuned optimum. |
| `exclude` | `[]` | Skill ids removed from routing entirely: never judged, never billed, denied by the gate unless you slash-invoke them. |
| `alwaysAllow` | `[]` | Skill ids the gate always lets through ([when to use it](claude-code-hooks.md#keeping-a-routed-skill-always-callable)). |
| `log` | off | `true` writes one line per routed turn, with every judged skill's probability, to `route-<session>.jsonl` in the state directory; a directory path writes it there instead. Off by default because it keeps prompt text on disk ([recording scores](claude-code-hooks.md#recording-scores)). |
| `judge` | `jev` | `mock` runs the free keyword judge, for testing the plumbing only. |
| `shardSize` | `250` | Nouls per Jev request; shards run in parallel. |
| `skillsDir` | `~/.agents/skills` | CLI only. The hooks route on Claude Code's own catalog instead. |
| `top` | | CLI display only: how many scored rows to print. |

How the bands and cap combine: [how routing works → policy](../architecture/how-routing-works.md#2-policy-two-bands-and-a-cap).

## Which file wins

> [!WARNING]
> The first config found wins, and files don't merge: a project `.skillrouter.json`
> replaces your home file, including its `exclude` and `alwaysAllow` lists.

- **Hooks:** `.skillrouter.json` in the folder Claude Code was started from (parent folders
  aren't searched), else `~/.skillrouter.json`.
- **CLI:** options resolve as flag > environment > config file > default. The config file is
  `--config <path>`, else `.skillrouter.json` in the cwd, else `~/.skillrouter.json`.

## Editing the lists

With the [CLI](install.md#option-2-the-cli) linked, edit `exclude` and `alwaysAllow` with
`jev-skill-router config` instead of by hand. Plugin-only installs have no command, so edit
`.skillrouter.json` directly.

```bash
jev-skill-router config exclude add anthropic-skills:docs
jev-skill-router config allow add anthropic-skills:pdf --project
jev-skill-router config exclude remove brief debrief
jev-skill-router config show
```

- `add` checks each id against the catalog the router judges and writes nothing on a miss,
  so `exclude add docs` answers "did you mean anthropic-skills:docs?".
- `--project` targets `./.skillrouter.json`.
- `show` prints the file in effect where you run it, flagging entries that name no routed
  skill.

`exclude` is the config expression of "I picked a favorite": when two skills do the same
job, keep one and exclude the rest. The [catalog doctor](catalog-doctor.md) finds those
pairs.
