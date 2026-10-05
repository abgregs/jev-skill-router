# Claude Code hooks

Two hooks take skill selection off the main agent. Both install with the plugin
([install](install.md)).

| Hook | Role | What it does |
|---|---|---|
| `hooks/user-prompt-submit.ts` | Routing | Fires before the model sees the turn, routes the prompt and recent transcript, saves the verdict, and injects "Invoke: … / Also relevant: …" into context. |
| `hooks/pre-tool-use-gate.ts` | Enforcement | Matched on the `Skill` tool. Denies routed skills that aren't on the turn's approved list or named in the SKILL.md of a skill loaded this turn, and skills the config excludes. |

## Routing hook

- The skill decision is made before the agent starts thinking.
- **Slash commands win.** Any catalog skill you slash-invoke (`/improve-animations …`) is
  promoted into the invoke band with certainty, past the judge's score and the cap, so the
  instruction the model reads matches what you commanded.
- Silent on conversational turns. On an error it shows a one-line notice and never breaks
  the turn.

### What Jev reads

Your prompt, with the last ~2,000 characters of user and assistant text as background,
judged against each skill's name and description. It doesn't read `CLAUDE.md`, open files,
or tool output; the model still sees all of those as usual.

> [!TIP]
> If a `CLAUDE.md` rule requires a skill, add that skill to `alwaysAllow` so the gate never
> turns it away.

## The gate

> [!NOTE]
> The gate is **fail-open**: a relevance filter, not a lock. No verdict, a stale verdict, or
> any error lets the call through to Claude Code's normal permission flow. To truly block a
> skill, use Claude Code's own `Skill(name)` deny rules.

The gate runs only when the model calls the `Skill` tool. Nothing is checked at routing
time: each call is tested against the verdict the routing hook saved for the turn.

**Always allowed:**
- Skills you typed as a slash command: `/git-commit`, `/anthropic-skills:pdf`, or the base
  `/name` of a namespaced skill.
- Skills in the config's `alwaysAllow` list.
- Any skill the router didn't judge.
- Skills named in the SKILL.md of a skill already loaded this turn, so an orchestrator
  (like `better-interface`) can call its leaves even when they scored below both bands.
  "Loaded" means let through by the gate earlier in the turn, for any reason; the record
  empties with each new verdict. When a call misses the list, the gate opens each loaded
  skill's SKILL.md on disk and looks for a deliberate reference to the called skill:
  `` `name` ``, `/name`, or "name skill". A match lets the call through and records that
  skill as loaded too, so chains work. A suggested skill vouches for nothing until the model
  loads it, and excluded skills stay denied. The gate can't tell "use `x`" from "`x` owns
  this, not me", so a scope note also opens the door. That only permits the call; the model
  still decides.

**Only a slash command counts as your say-so.** A skill you ask for in prose ("use the
git-commit skill", "update our docs") can score higher because the router reads your prompt,
but it runs only if the verdict carries it or it's in `alwaysAllow`. Otherwise the gate
denies the model's call.

## What gets routed

The routed catalog is what Claude Code loads at session start:

- personal `~/.claude/skills`
- the project's `.claude/skills`, from the session directory up to the repository root (a
  personal skill shadows a same-named project skill, as in Claude Code)
- skills synced from claude.ai (`~/.claude/skills/synced/`), routed as
  `anthropic-skills:<name>`

Never judged, and passed by the gate untouched: bundled and plugin-provided skills, skills
nested below the session directory, `--add-dir` and managed skills, and skills without a
`description`.

## Keeping a routed skill always callable

The gate denies a routed skill that missed the turn's verdict, even when the need only shows
up mid-turn. Ask "pull the revenue table out of the board deck in `./reports/` into a
spreadsheet" and the verdict may carry `anthropic-skills:xlsx` but not
`anthropic-skills:pdf`, because nothing in the prompt says PDF. When the agent opens the
deck, finds a PDF, and reaches for the pdf skill, the gate denies it. List the skill in
`alwaysAllow` and that call passes:

```json
{ "alwaysAllow": ["anthropic-skills:pdf", "git-commit"] }
```

or `jev-skill-router config allow add anthropic-skills:pdf git-commit`
([configuration](configuration.md#editing-the-lists)).

- **Use the routed id.** Synced skills are `anthropic-skills:<name>`; that entry passes a
  call by either the full name or the short `pdf`. A bare `"pdf"` only matches calls made by
  the short name, and names your local `pdf` skill if you have one.
- **It only unblocks.** `alwaysAllow` never adds the skill to the verdict or tells the agent
  to use it, and the router still judges it every turn.
- **The trade-off:** you give up enforcement for that skill, so the agent can load it on
  turns that don't need it, spending context.
- **Good fits:** utility skills that act on file types a prompt may not name, and process
  skills your standing instructions require (`git-commit` above).
