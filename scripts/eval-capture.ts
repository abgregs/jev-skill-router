// Capture REAL Jev routing results locally: for each labeled fixture, over each
// catalog, route the session with the real Jev judge — every skill judged, one Noul
// each, sharded and fanned out in parallel — and write the full probability map to
// fixtures/recordings/*.json for later replay (the recorded judge and the web demo
// consume these verbatim).
//
//   TYPESAFE_API_KEY=sk-... npm run eval:capture                 # projects cost, then runs
//   npm run eval:capture -- --dry-run                            # just print projected cost
//   npm run eval:capture -- --catalog real --fixtures payments-rollback
//   npm run eval:capture -- --catalog both --max-nouls 6000      # allow the big synthetic run
//
// Cost is REAL: one Noul per judged skill. Synthetic runs are ~1000 Nouls PER fixture, so
// the script refuses to exceed --max-nouls (default 2000) unless you raise it deliberately.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { route } from '../lib/router/index.js'
import { loadSkills } from '../lib/skills/loadSkills.js'
import { synthesizeCatalog } from '../lib/skills/synthesize.js'
import { DEFAULT_ROUTE_OPTIONS } from '../lib/skills/types.js'
import type { RouteResult, Skill } from '../lib/skills/types.js'
import { SESSIONS, fixtureTargets } from '../fixtures/sessions.js'

function parseArgs(argv: string[]): { opts: Record<string, string>; bools: Set<string> } {
  const opts: Record<string, string> = {}
  const bools = new Set<string>()
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string
    if (!a.startsWith('--')) continue
    const key = a.slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith('--')) bools.add(key)
    else {
      opts[key] = next
      i++
    }
  }
  return { opts, bools }
}

function expandHome(p: string): string {
  return p.startsWith('~') ? resolve(homedir(), p.slice(1).replace(/^\/+/, '')) : resolve(p)
}

/** Precision / recall / F1 of a predicted id set against a ground-truth id set. */
function prf(predicted: Set<string>, truth: Set<string>) {
  if (truth.size === 0) return { precision: 0, recall: 0, f1: 0 }
  let tp = 0
  for (const id of predicted) if (truth.has(id)) tp++
  const precision = predicted.size ? tp / predicted.size : 0
  const recall = tp / truth.size
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0
  return { precision, recall, f1 }
}

/** {skillId: probability} for every judged skill in a route result. */
function probMap(result: RouteResult): Record<string, number> {
  const out: Record<string, number> = {}
  for (const s of result.scored) if (s.judged && s.probability !== null) out[s.skill.id] = s.probability
  return out
}

const { opts, bools } = parseArgs(process.argv.slice(2))

const whichCatalogs = (opts.catalog ?? 'both') as 'real' | 'synthetic' | 'both'
const maxNouls = opts['max-nouls'] ? Number(opts['max-nouls']) : 2000
const outDir = expandHome(opts.out ?? resolve('fixtures/recordings'))
const skillsDir = expandHome(opts['skills-dir'] ?? process.env.SKILLS_DIR ?? '~/.agents/skills')
// Same semantics as route-cli's exclude: ids removed from routing entirely, so a
// recording captures the catalog the user actually routes on.
const exclude = new Set(opts.exclude?.split(',').map((s) => s.trim()).filter(Boolean) ?? [])

const fixtureFilter = opts.fixtures?.split(',').map((x) => x.trim())
const fixtures = fixtureFilter ? SESSIONS.filter((s) => fixtureFilter.includes(s.id)) : SESSIONS
if (fixtures.length === 0) {
  console.error(`No matching fixtures. Available: ${SESSIONS.map((s) => s.id).join(', ')}`)
  process.exit(1)
}

// Resolve the requested catalogs once.
const catalogs: { name: string; skills: Skill[] }[] = []
if (whichCatalogs === 'real' || whichCatalogs === 'both') {
  const real = loadSkills([{ dir: skillsDir, scope: 'global' }]).filter((s) => !exclude.has(s.id))
  if (real.length === 0) {
    console.error(`No real skills in ${skillsDir}. Use --skills-dir or --catalog synthetic.`)
    process.exit(1)
  }
  catalogs.push({ name: 'real', skills: real })
}
if (whichCatalogs === 'synthetic' || whichCatalogs === 'both') {
  catalogs.push({ name: 'synthetic', skills: synthesizeCatalog() })
}

// Project real Noul cost BEFORE spending anything (one Noul per judged skill).
let projected = 0
for (const c of catalogs) projected += c.skills.length * fixtures.length

console.log('eval:capture — projected REAL Noul spend')
for (const c of catalogs) {
  console.log(
    `  ${c.name}: ${c.skills.length} skills × ${fixtures.length} fixtures → ${c.skills.length * fixtures.length} Nouls`
  )
}
console.log(`  TOTAL: ${projected} Nouls  (cap --max-nouls=${maxNouls})\n`)

if (bools.has('dry-run')) {
  console.log('Dry run — no API calls made.')
  process.exit(0)
}
if (projected > maxNouls) {
  console.error(
    `Projected ${projected} Nouls exceeds --max-nouls ${maxNouls}. Scope it down ` +
      `(--catalog real, --fixtures <id>) or raise --max-nouls deliberately.`
  )
  process.exit(1)
}

if (!process.env.TYPESAFE_API_KEY && existsSync('.env.local')) process.loadEnvFile('.env.local')
if (!process.env.TYPESAFE_API_KEY) {
  console.error('TYPESAFE_API_KEY is not set. Export it, or put it in .env.local next to package.json.')
  process.exit(1)
}
const { createJevJudge } = await import('../lib/router/jevJudge.js')
const judge = createJevJudge()

mkdirSync(outDir, { recursive: true })

for (const catalog of catalogs) {
  const catalogIds = new Set(catalog.skills.map((s) => s.id))
  for (const fixture of fixtures) {
    const truth = new Set(fixture.expected)
    // A fixture run against a catalog its expected ids don't live in is a NEGATIVE
    // CONTROL: the only correct outcome is selecting nothing. P/R/F1 vs truth is
    // structurally zero there — reporting it as quality would be dishonest.
    const targeted = fixtureTargets(fixture, catalog.name as 'real' | 'synthetic')
    const missingTruth = fixture.expected.filter((id) => !catalogIds.has(id))
    if (targeted && missingTruth.length > 0) {
      console.warn(
        `\nWARNING ${catalog.name}·${fixture.id}: expected ids not in catalog: ${missingTruth.join(', ')}`
      )
    }
    console.log(
      `\n=== ${catalog.name} · ${fixture.id} (${catalog.skills.length} skills)` +
        `${targeted ? '' : ' · NEGATIVE CONTROL (out-of-domain query — correct outcome: select nothing)'} ===`
    )
    console.log(`Query: ${fixture.session.latestQuery}`)

    const run = await route(fixture.session, catalog.skills, judge)
    const selected = new Set(run.selected.map((s) => s.id))

    const verdict = targeted
      ? (() => {
          const g = prf(selected, truth)
          return `vs truth P=${g.precision.toFixed(2)} R=${g.recall.toFixed(2)} F1=${g.f1.toFixed(2)}`
        })()
      : selected.size === 0
        ? 'negative control: abstained ✓'
        : `negative control: selected ${selected.size} skill(s) — judge semantic fit yourself`

    console.log(
      `judged ${run.judgedCount} in ${run.shards} shard(s), ${run.latencyMs}ms` +
        ` · selected [${[...selected].join(', ') || 'none'}] · ${verdict}`
    )

    const recording = {
      fixtureId: fixture.id,
      catalog: catalog.name,
      catalogSize: catalog.skills.length,
      query: fixture.session.latestQuery,
      /** Session fields the judge saw: the same two the plugin and CLI send. */
      judgedInputs: ['latestQuery', 'transcript'],
      groundTruth: [...truth],
      /** True when this fixture's expected ids live in another catalog (abstention check). */
      negativeControl: !targeted,
      threshold: run.threshold ?? DEFAULT_ROUTE_OPTIONS.threshold,
      run: {
        probabilities: probMap(run),
        selected: [...selected],
        judgedCount: run.judgedCount,
        shards: run.shards,
        latencyMs: run.latencyMs
      }
    }
    const file = resolve(outDir, `${catalog.name}-${fixture.id}.json`)
    writeFileSync(file, JSON.stringify(recording, null, 2))
    console.log(`wrote ${file}`)
  }
}

console.log('\nDone.')
