// Live smoke test of the REAL Jev judge — the createJevJudge() analogue of inspect.ts.
// Runs ONE labeled fixture through route() against the real installed catalog: every
// skill judged (one Noul each), so the run costs a few dozen Nouls and shows real
// routing quality. This is the run that measures Jev's SEMANTIC edge, which the mock
// cannot show (see mockJudge.ts honesty note).
//
// Requires a key:  TYPESAFE_API_KEY=sk-... npm run route:live [fixtureId]
// Default is the first real-catalog fixture in fixtures/sessions.ts. Pass an id to
// pick another.
import { route } from '../lib/router/index.js'
import { createJevJudge } from '../lib/router/jevJudge.js'
import { loadSkills } from '../lib/skills/loadSkills.js'
import { SESSIONS, fixtureTargets } from '../fixtures/sessions.js'

if (!process.env.TYPESAFE_API_KEY) {
  console.error('TYPESAFE_API_KEY is not set. Run:  TYPESAFE_API_KEY=sk-... npm run route:live')
  process.exit(1)
}

const wanted = process.argv[2]
const fixture = wanted
  ? SESSIONS.find((s) => s.id === wanted)
  : SESSIONS.find((s) => fixtureTargets(s, 'real'))
if (!fixture) {
  console.error(`No fixture "${wanted}". Available: ${SESSIONS.map((s) => s.id).join(', ')}`)
  process.exit(1)
}

const catalog = loadSkills()
const judge = createJevJudge()
const expected = new Set(fixture.expected)

console.log(`Fixture: ${fixture.id}  ·  catalog ${catalog.length} skills  ·  judge=${judge.name}`)
console.log(`Query: ${fixture.session.latestQuery}\n`)

const result = await route(fixture.session, catalog, judge)

console.log(`Judged ${result.judgedCount} skills in ${result.shards} shard(s), ${result.latencyMs}ms.`)
console.log(`Selected at threshold ${result.threshold}: ${result.selected.map((s) => s.id).join(', ') || '(none)'}`)
console.log(`Ground truth: ${[...expected].join(', ')}\n`)

console.log('Top judged skills by p(should invoke):')
for (const s of result.scored.filter((x) => x.judged).slice(0, 12)) {
  const p = (s.probability ?? 0).toFixed(2)
  const mark = expected.has(s.skill.id) ? ' ← ground truth' : ''
  const sel = result.selected.some((x) => x.id === s.skill.id) ? ' [selected]' : ''
  console.log(`  ${p}  ${s.skill.id}${sel}${mark}`)
}
