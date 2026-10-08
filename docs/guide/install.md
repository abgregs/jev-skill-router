# Install

> [!NOTE]
> **Requirements:** Claude Code (the only supported host), Node 20.12+ on your `PATH` (the
> hooks run as `node` scripts in both install paths), and a TypeSafe API key.

## Cost

The router asks Jev about every routed skill on every prompt: one Noul per skill per turn,
so a 51-skill catalog spends 51 Nouls a prompt, plus one Noul for each off-list skill call
the gate re-judges ([hooks](claude-code-hooks.md#the-gate)). Skills you `exclude` are never
judged and cost nothing (see [configuration](configuration.md)). Expect the router to add
cost and time to a session, not remove it: a paired A/B on opus found it loads more skill
text and spends more than stock selection, in exchange for workflow skills firing that the
model skips on its own ([results](../evaluation/results.md#development-runs)).

## Option 1: the plugin (recommended)

The repo is a Claude Code plugin and its own marketplace. The hooks ship as committed,
dependency-free bundles (`dist/`), so there is no `settings.json` editing and no path to go
stale. To install, run:

```
claude /plugin marketplace add abgregs/jev-skill-router
claude /plugin install jev-skill-router@abgregs
```

In the Claude Code desktop app or an already open Claude Code session, run:

```
/plugin marketplace add abgregs/jev-skill-router
/plugin install jev-skill-router@abgregs
```

That registers two hooks: routing before every prompt, and a gate on the `Skill` tool
([details](claude-code-hooks.md)).

**Uninstall:** `/plugin uninstall jev-skill-router@abgregs`.

## The API key

- Claude Code asks for the key when it enables the plugin and keeps it in your system's
  credential store, not in `settings.json`.
- `/plugin configure jev-skill-router@abgregs` sets or changes it later.
- An exported `TYPESAFE_API_KEY` also works and takes precedence.

The hooks look for the key in this order: exported `TYPESAFE_API_KEY`, then the plugin's
stored key, then (for a clone install) the clone's `.env.local`. With no key, routing and
the gate both stay off, and the router says so once per session. Any other routing failure
is reported on its turn, and the gate lets that turn through.

## Option 2: the CLI

The plugin installs only the hooks. The `jev-skill-router` command (`config`, `doctor`,
`route`, and `install claude`) comes from a clone; it isn't published to npm:

```bash
git clone https://github.com/abgregs/jev-skill-router
cd jev-skill-router
npm install && npm link    # puts jev-skill-router on your PATH
```

`npm link` installs the command for the active Node version; with nvm, switching versions
hides it until you run `npm link` again. `npm rm -g jev-skill-router` removes it.

### Hooks without the plugin

With the command linked, `jev-skill-router install claude` writes the hook registration
into `~/.claude/settings.json` (`--project` for the project file) with resolved absolute
paths to the bundles.

```bash
jev-skill-router install claude          # or --dry-run to preview the settings diff
```

- **Idempotent:** existing router entries, including stale paths from a previous clone, are
  replaced.
- **Uninstall:** `--uninstall` removes them cleanly.
- The hooks run from the clone, so keep it in place.

## Local plugin development

`claude --plugin-dir /path/to/jev-skill-router` loads the working tree as the plugin;
`/reload-plugins` picks up a rebuild without restarting.
