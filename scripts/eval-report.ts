// Read the real-catalog recordings back through the shipped policy and report both
// sides of routing quality: needed skills invoked on the task fixtures, and needless
// loads on the no-skill fixtures. No API calls; the recordings are the whole input.
//
//   npm run eval:report
//   npm run eval:report -- --baseline <dir>   # also diff p against older recordings
//
// A needless load is any skill invoked (p >= threshold) on a prompt that needs none.
// Suggestions (names only, 0.80–0.85) are counted separately: they cost a name, not a
// skill body.
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { applyPolicy } from '../lib/router/index.js'
import { DEFAULT_ROUTE_OPTIONS } from '../lib/skills/types.js'
import type { Skill, SkillScore } from '../lib/skills/types.js'
import { FIXTURE_TRUTH_EXTRA, SESSIONS } from '../fixtures/sessions.js'
import { NO_SKILL_SESSIONS } from '../fixtures/no-skill-sessions.js'

interface Recording {
  fixtureId: string
  catalog: string
  negativeControl: boolean
  run: { probabilities: Record<string, number> }
}

const DIR = resolve('fixtures/recordings')
const args = process.argv.slice(2)
const baselineArg = args.indexOf('--baseline')
const baselineDir = baselineArg >= 0 ? resolve(args[baselineArg + 1] as string) : null

function load(dir: string): Recording[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((f) => f.startsWith('real-') && f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as Recording)
}

/** The shipped policy over one recording: invoked and suggested ids. */
function verdict(rec: Recording) {
  const scored: SkillScore[] = Object.entries(rec.run.probabilities).map(([id, p]) => ({
    skill: { id } as Skill,
    probability: p,
    judged: true
  }))
  const { selected, suggested } = applyPolicy(scored, DEFAULT_ROUTE_OPTIONS)
  return { invoked: selected.map((s) => s.id), suggested: suggested.map((s) => s.id) }
}

const p = (rec: Recording, id: string) => (rec.run.probabilities[id] ?? 0).toFixed(2)
const top = (rec: Recording) =>
  Object.entries(rec.run.probabilities).sort((a, b) => b[1] - a[1])[0] as [string, number]

// ---- task fixtures: hits, the user-only skill, negative controls
const tasks = load(DIR)
let needed = 0
let hit = 0
console.log(`TASK FIXTURES (${tasks.length}) at threshold ${DEFAULT_ROUTE_OPTIONS.threshold}`)
for (const rec of tasks) {
  const { invoked } = verdict(rec)
  const extra = FIXTURE_TRUTH_EXTRA[rec.fixtureId] ?? []
  const truth = rec.negativeControl
    ? extra
    : [...(SESSIONS.find((s) => s.id === rec.fixtureId)?.expected ?? []), ...extra]
  // A negative control passes when it invokes nothing beyond its needed in-catalog skill.
  const label = rec.negativeControl
    ? invoked.every((id) => extra.includes(id))
      ? 'negative control: no stand-in ✓'
      : `negative control: STAND-IN ${invoked.filter((id) => !extra.includes(id)).join(', ')}`
    : ''
  const inCatalog = truth.filter((id) => id in rec.run.probabilities)
  needed += rec.negativeControl ? 0 : inCatalog.length
  hit += rec.negativeControl ? 0 : inCatalog.filter((id) => invoked.includes(id)).length
  const missed = inCatalog.filter((id) => !invoked.includes(id))
  const userOnly = truth.length > 0 && inCatalog.length === 0
  console.log(
    `  ${rec.fixtureId.padEnd(20)} invoked [${invoked.join(', ') || 'none'}]` +
      (label ? ` · ${label}` : '') +
      (userOnly ? ` · user-only skill ${invoked.length ? 'NOT left to the user' : 'left to the user ✓'}` : '') +
      (missed.length ? ` · MISSED ${missed.map((id) => `${id} ${p(rec, id)}`).join(', ')}` : '')
  )
}
console.log(`  needed skills invoked: ${hit} / ${needed}\n`)

// ---- no-skill fixtures: needless loads and needless suggestions
const noSkill = load(join(DIR, 'no-skill'))
const byCategory = new Map<string, { n: number; loads: number; suggests: number }>()
const tops: number[] = []
let loads = 0
let suggestsOnly = 0
console.log(`NO-SKILL FIXTURES (${noSkill.length} of ${NO_SKILL_SESSIONS.length})`)
for (const rec of noSkill) {
  const fixture = NO_SKILL_SESSIONS.find((s) => s.id === rec.fixtureId)
  const category = fixture?.category ?? 'unknown'
  const { invoked, suggested } = verdict(rec)
  const [topId, topP] = top(rec)
  tops.push(topP)
  const c = byCategory.get(category) ?? { n: 0, loads: 0, suggests: 0 }
  c.n++
  if (invoked.length) {
    loads++
    c.loads++
  } else if (suggested.length) {
    suggestsOnly++
    c.suggests++
  }
  byCategory.set(category, c)
  const outcome = invoked.length
    ? `NEEDLESS LOAD ${invoked.map((id) => `${id} ${p(rec, id)}`).join(', ')}`
    : suggested.length
      ? `suggested ${suggested.map((id) => `${id} ${p(rec, id)}`).join(', ')}`
      : 'nothing ✓'
  const trapNote = fixture?.traps.length ? ` · traps ${fixture.traps.map((id) => `${id} ${p(rec, id)}`).join(', ')}` : ''
  console.log(`  ${rec.fixtureId.padEnd(24)} ${outcome} · top ${topId} ${topP.toFixed(2)}${trapNote}`)
}
if (noSkill.length) {
  tops.sort((a, b) => a - b)
  const pct = (k: number) => `${k} / ${noSkill.length} (${((100 * k) / noSkill.length).toFixed(1)}%)`
  console.log(`  needless loads: ${pct(loads)}`)
  console.log(`  suggestions only: ${pct(suggestsOnly)}`)
  console.log(
    `  top wrong p: min ${tops[0]?.toFixed(2)} · median ${tops[Math.floor(tops.length / 2)]?.toFixed(2)} · max ${tops.at(-1)?.toFixed(2)}`
  )
  for (const [category, c] of byCategory) {
    console.log(`    ${category.padEnd(16)} ${c.loads} load(s), ${c.suggests} suggest-only, of ${c.n}`)
  }
}

// ---- drift against older recordings of the same fixtures
if (baselineDir) {
  const before = new Map(load(baselineDir).map((r) => [r.fixtureId, r]))
  console.log(`\nDRIFT vs ${baselineDir}`)
  for (const rec of tasks) {
    const old = before.get(rec.fixtureId)
    if (!old) continue
    let maxId = ''
    let maxD = 0
    for (const [id, pNew] of Object.entries(rec.run.probabilities)) {
      const d = Math.abs(pNew - (old.run.probabilities[id] ?? pNew))
      if (d > maxD) [maxId, maxD] = [id, d]
    }
    const a = verdict(old).invoked.sort().join(', ')
    const b = verdict(rec).invoked.sort().join(', ')
    console.log(
      `  ${rec.fixtureId.padEnd(20)} max |Δp| ${maxD.toFixed(2)} (${maxId} ${p(old, maxId)} → ${p(rec, maxId)})` +
        (a === b ? '' : ` · invoked [${a}] → [${b}]`)
    )
  }
}
