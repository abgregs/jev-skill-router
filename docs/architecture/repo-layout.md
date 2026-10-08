# Repo layout

```
jev-skill-router/
├── hooks/
│   ├── user-prompt-submit.ts   # routes each prompt
│   ├── pre-tool-use-gate.ts    # enforces the verdict
│   └── hooks.json              # plugin hook registration
├── lib/
│   ├── router/
│   │   ├── runRoute.ts         # config + catalog + judge → route
│   │   ├── route.ts            # shard, fan out, apply policy
│   │   ├── policy.ts           # invoke and suggest bands, cap
│   │   ├── jevJudge.ts         # real judge (default); also the gate's re-judge
│   │   ├── jevKey.ts           # finds the TypeSafe key for runRoute and the gate
│   │   ├── mockJudge.ts        # keyword judge, free
│   │   └── recordedJudge.ts    # replays recordings
│   ├── skills/
│   │   ├── loadSkills.ts       # reads SKILL.md catalogs
│   │   └── synthesize.ts       # 1,064-skill test catalog
│   ├── doctor.ts               # catalog doctor
│   └── config.ts               # .skillrouter.json
├── scripts/
│   ├── cli.ts                  # the jev-skill-router command
│   ├── eval-capture.ts         # records real-Jev runs
│   ├── session-bench.ts        # paired A/B of real sessions, stock vs router
│   ├── demo-data.ts            # recordings → demo data
│   └── build.ts                # bundles into dist/
├── fixtures/
│   ├── sessions.ts             # labeled eval fixtures
│   ├── no-skill-sessions.ts    # prompts that need no skill
│   └── recordings/             # captured real-Jev runs
├── dist/                       # committed bundles: command + hooks
├── web/                        # recorded demo page
├── bench/                      # scale benchmark, development runs
├── docs/                       # these docs
└── .claude-plugin/             # plugin and marketplace manifests
```

## Where to start

| To change… | Start in |
|---|---|
| What Jev is asked about each skill | `lib/router/jevJudge.ts` |
| How scores become invoke and suggest | `lib/router/policy.ts` |
| Which skills get loaded and routed | `lib/skills/loadSkills.ts` |
| What the gate allows or denies | `hooks/pre-tool-use-gate.ts` |
| Doctor findings | `lib/doctor.ts` |
| Eval fixtures and their labels | `fixtures/sessions.ts` |

## The three judges

| Judge | Use | Notes |
|---|---|---|
| **Jev** (`jevJudge`) | The default everywhere | Real semantic judgment; needs a key. |
| **Mock** (`mockJudge`) | `--judge mock`, or `"judge": "mock"` in config | Deterministic and free. Scores on keywords, so it validates the pipeline and the fan-out's cost accounting, **not** Jev's routing quality. |
| **Recorded** (`recordedJudge`) | The web demo | Replays captured real-Jev results verbatim, and fails loud rather than improvise. |
