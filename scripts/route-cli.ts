// `jev-skill-router route` — route a query against the user's installed skills and
// print which skills the router would have an agent invoke. Provider-agnostic: any
// host (Claude Code, Codex, …) can shell out to it or import runRoute() directly.
//
//   npm run route -- "add a datadog dashboard for the payments rollback"
//   npm run route -- "..." --threshold 0.8
//   npm run route -- "..." --judge jev --skills-dir ~/.claude/skills --top 20
//
// Skills are read from a directory of `<slug>/SKILL.md` folders. Default is the canonical
// `npx skills` store (~/.agents/skills), the provider-neutral source of truth; override with
// --skills-dir or SKILLS_DIR to point at ~/.claude/skills or a project catalog.
//
// The default judge is Jev, which needs TYPESAFE_API_KEY (from the environment, or a
// local .env.local next to package.json). --judge mock is a free keyword-only dry run
// for testing the plumbing.
//
// Options resolve as: CLI flag > environment > config file > built-in default. The config
// file is --config <path>, else .skillrouter.json in the cwd, else ~/.skillrouter.json —
// any subset of: skillsDir, judge, threshold, suggestFloor, maxSelected, shardSize,
// top, exclude (skill ids removed from routing entirely).
//
// --json emits one machine-readable object ({invoke, suggest, probabilities, ...}) for
// host adapters (e.g. a Claude Code UserPromptSubmit hook) instead of the human table.
import { loadConfigFile } from '../lib/config.js'
import { runRoute } from '../lib/router/runRoute.js'

interface Args {
  opts: Record<string, string>
  bools: Set<string>
  positional: string[]
}

function parseArgs(argv: string[]): Args {
  const opts: Record<string, string> = {}
  const bools = new Set<string>()
  const positional: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string
    if (a.startsWith('--')) {
      const key = a.slice(2)
      const next = argv[i + 1]
      if (next === undefined || next.startsWith('--')) bools.add(key)
      else {
        opts[key] = next
        i++
      }
    } else positional.push(a)
  }
  return { opts, bools, positional }
}

const USAGE =
  'Usage: jev-skill-router route "<query>" [--skills-dir DIR] [--threshold N] ' +
  '[--suggest-floor N] [--max-selected N] [--judge mock|jev] [--exclude a,b] [--top N] [--config PATH] [--json]'

export async function main(argv: string[]): Promise<void> {
  const { opts, bools, positional } = parseArgs(argv)

  if (bools.has('help')) {
    console.log(USAGE)
    return
  }
  const query = (opts.query ?? positional.join(' ')).trim()
  if (!query) {
    console.error(USAGE)
    process.exit(1)
  }

  const num = (flag: string) => (opts[flag] !== undefined ? Number(opts[flag]) : undefined)
  const list = (flag: string) => opts[flag]?.split(',').map((s) => s.trim()).filter(Boolean)

  let out
  try {
    out = await runRoute({
      query,
      transcript: opts.transcript,
      openFiles: list('open-files'),
      projectRules: opts.rules,
      configPath: opts.config,
      skillsDir: opts['skills-dir'],
      judge: opts.judge,
      threshold: num('threshold'),
      suggestFloor: num('suggest-floor'),
      maxSelected: num('max-selected'),
      shardSize: num('shard-size'),
      exclude: list('exclude')
    })
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }
  const { result, skillsDir } = out

  if (bools.has('json')) {
    console.log(
      JSON.stringify(
        {
          query,
          skillsDir,
          catalogSize: out.catalogSize,
          judge: out.judge,
          threshold: result.threshold,
          judgedCount: result.judgedCount,
          shards: result.shards,
          latencyMs: result.latencyMs,
          invoke: out.invoke,
          suggest: out.suggest,
          probabilities: out.probabilities
        },
        null,
        2
      )
    )
    return
  }

  // `top` is display-only, so runRoute doesn't resolve it — read the config layer here.
  const cfg = loadConfigFile(opts.config)
  const top = num('top') ?? (typeof cfg.top === 'number' ? cfg.top : 15)
  const selectedIds = new Set(out.invoke)

  console.log(`\nQuery: ${query}`)
  console.log(`Catalog: ${out.catalogSize} skills from ${skillsDir}  ·  judge=${out.judge}`)
  console.log(
    `Judged ${result.judgedCount} in ${result.shards} shard(s), ${result.latencyMs}ms  ·  selected ${result.selected.length} at p ≥ ${result.threshold}\n`
  )

  const rows = result.scored.filter((s) => s.judged).slice(0, top)
  if (rows.length === 0) console.log('(no skills judged)')
  for (const s of rows) {
    const p = (s.probability ?? 0).toFixed(2)
    const mark = selectedIds.has(s.skill.id) ? '✓' : ' '
    console.log(`  ${mark}  ${p}  ${s.skill.id}`)
  }

  if (out.invoke.length > 0) {
    console.log(`\nInvoke: ${out.invoke.join(', ')}`)
  } else {
    console.log('\nInvoke: (none above threshold)')
  }
  if (out.suggest.length > 0) {
    console.log(`Suggest: ${out.suggest.join(', ')}`)
  }
}
