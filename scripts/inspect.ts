// End-to-end smoke test of the PURE-CODE layer — no Jev, no network, no API key.
// Verifies: (1) real SKILL.md loading, (2) synthetic Uber-scale catalog generation,
// (3) the full route() pipeline (mock judge) ranking the right skills for a
// realistic session. Run: npm run inspect
import { loadSkills } from '../lib/skills/loadSkills.js'
import { synthesizeCatalog } from '../lib/skills/synthesize.js'
import { createMockJudge, route } from '../lib/router/index.js'
import type { SessionState } from '../lib/skills/types.js'

// --- 1. Real skills on disk (one of two catalog sources) ---
const real = loadSkills()
console.log(`Real on-disk skills loaded: ${real.length}`)

// --- 2. Synthetic org catalog (the >255 scale fixture) ---
const catalog = synthesizeCatalog()
console.log(`Synthetic org catalog generated: ${catalog.length} skills (target > 1000)`)
const samples = ['deploy-service-payments', 'rollback-release-maps', 'promote-to-prod']
for (const id of samples) {
  const s = catalog.find((c) => c.id === id)
  console.log(`  · ${id}: ${s ? s.description : 'MISSING'}`)
}

// --- 3. Full pipeline over the whole catalog for a realistic session (mock judge) ---
const session: SessionState = {
  latestQuery:
    'the payments service is throwing 500s at checkout right after the last deploy — ' +
    'we need to roll it back and pull up the dashboard to see the error rate',
  transcript:
    'User: on-call for payments tonight. Assistant: acknowledged, watching error budget.'
}

const result = await route(session, catalog, createMockJudge())
console.log(
  `\nRouted ${result.judgedCount} skills in ${result.shards} shard(s) ` +
    `(${result.latencyMs}ms modeled). Top of the ranking:`
)
for (const s of result.scored.slice(0, 10)) {
  console.log(`  ${(s.probability ?? 0).toFixed(2)}  ${s.skill.id}`)
}
console.log(
  '\nExpect payments-scoped rollback/deploy/dashboard/trace skills on top, and NOT the maps/eats variants.'
)
