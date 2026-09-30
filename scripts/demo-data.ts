import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { route, applyPolicy, createRecordedJudge, runFromEvalRecording } from '../lib/router/index.js'
import { loadSkills } from '../lib/skills/loadSkills.js'
import { synthesizeCatalog } from '../lib/skills/synthesize.js'
import type { Skill, SkillScore, SessionState } from '../lib/skills/types.js'
import { SESSIONS } from '../fixtures/sessions.js'

// Builds the recorded demo's static data: every captured real-Jev run replayed through
// the REAL pipeline, written once to web/data/replays.json. The browser only renders.
//
// Honesty rules of this file:
//   - the recording defines the candidate set. The catalog is reconstructed FROM the
//     capture's probability keys (disk only enriches descriptions), so the recorded
//     judge can never hit a drifted candidate and silently guess.
//   - every replay goes through route() + createRecordedJudge end to end — the real
//     orchestrator and policy, with only the judgment served from the capture.
//   - displayed latency/judged/shard numbers come from the capture, never from the
//     replay's wall clock.
//   - selections are recomputed under the CURRENT policy (invoke 0.85, suggest band
//     0.80–0.85, maxSelected 6 — the shipped DEFAULT_ROUTE_OPTIONS); the capture's
//     original selection ships alongside so policy evolution is visible, not hidden.

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const RECORDINGS_DIR = join(ROOT, 'fixtures', 'recordings')
const OUT_FILE = join(ROOT, 'web', 'data', 'replays.json')

const POLICY = { threshold: 0.85, suggestFloor: 0.8, maxSelected: 6 }
const TEST_STRIP_THRESHOLDS = [0.8, 0.85, 0.9]

// Display exclusions (real catalog only). `brief` fires on "is this a non-trivial
// task" — a task-type-agnostic lifecycle signal that reads as noise beside
// task-matched skills — and `debrief` is its pair. Nouls are independent, so
// dropping them is an exact projection onto the 51-skill catalog and every other
// number is unchanged. The raw recordings keep the full 53-skill judgment.
const DISPLAY_EXCLUDE = new Set(['brief', 'debrief'])

// Ground-truth additions, display layer only — fixtures/sessions.ts stays
// pre-registered for the bench. Each entry is decided per fixture from the query
// and the skill's description, never from the run: truth is the skill each part
// of the ask can't do without, so skills that fit but aren't needed stay unmarked.
// maps-latency asks to look into a latency regression and diagnosing-bugs, which
// names performance-regression diagnosis as a use case, is the only real skill
// that covers it.
const FIXTURE_TRUTH_EXTRA: Record<string, string[]> = {
  'maps-latency': ['diagnosing-bugs']
}

interface CapturedRun {
  probabilities: Record<string, number>
  selected: string[]
  judgedCount: number
  shards: number
  latencyMs: number
}

interface Recording {
  fixtureId: string
  catalog: 'real' | 'synthetic'
  catalogSize: number
  query: string
  groundTruth: string[]
  negativeControl: boolean
  threshold: number
  run: CapturedRun | null
}

interface RunReplay {
  /** [skillId, probability] ranked desc — the recorded evidence, verbatim. */
  rows: [string, number][]
  /** Recomputed under POLICY via the real pipeline/policy code. */
  selected: string[]
  suggested: string[]
  /** The capture's own selection at its capture-time policy, for transparency. */
  capturedSelected: string[]
  judgedCount: number
  shards: number
  latencyMs: number
}

function skillsFromRecording(ids: string[], catalog: 'real' | 'synthetic', disk: Map<string, Skill>): Skill[] {
  return ids.map((id) => {
    const known = catalog === 'real' ? disk.get(id) : undefined
    return {
      id,
      name: known?.name ?? id,
      description: known?.description ?? '',
      scope: known?.scope ?? (catalog === 'synthetic' ? 'synthetic' : 'global'),
      source: known?.source ?? `recording:${id}`,
      keywords: []
    }
  })
}

function rankedRows(probabilities: Record<string, number>): [string, number][] {
  return Object.entries(probabilities).sort((a, b) => b[1] - a[1])
}

function scoredFromRun(run: CapturedRun, skills: Map<string, Skill>): SkillScore[] {
  return rankedRows(run.probabilities).map(([id, p]) => ({
    skill: skills.get(id)!,
    probability: p,
    judged: true
  }))
}

/**
 * Curated decoys — red may only mark a deliberately tested look-alike, and only the
 * ones that actually competed. Synthetic ids are `<base>-<service>`, so a candidate
 * decoy is a judged sibling (same segments except the last) of a truth id that scored
 * clearly below the suggest floor, capped at the highest-scoring few. Real-catalog
 * fixtures take a hand-curated list only; none exists yet, so they emit empty
 * (never inferred).
 */
const MAX_DECOYS = 4

// Curated decoys the sibling rule can't find: look-alikes that fail on verb or phase,
// named per synthetic fixture from the query and the skill's own description, never
// from the run. payments-rollback asks to pull up (view) a dashboard, while
// create-datadog-dashboard builds one and the catalog has no view skill.
// wallet-incident's incident is live, and write-postmortem's description sends live
// incidents to open-incident. A curated decoy the judge did not reject is not marked:
// the ‡ label claims a correct rejection.
const CURATED_DECOYS: Record<string, string[]> = {
  'payments-rollback': ['create-datadog-dashboard-payments'],
  'wallet-incident': ['write-postmortem']
}

function computeDecoys(rec: Recording): string[] {
  if (rec.catalog !== 'synthetic' || !rec.run) return []
  const probs = rec.run.probabilities
  const isSibling = (a: string, b: string): boolean => {
    const as = a.split('-')
    const bs = b.split('-')
    if (as.length !== bs.length || a === b) return false
    return as.slice(0, -1).join('-') === bs.slice(0, -1).join('-')
  }
  const decoys: [string, number][] = []
  for (const id of Object.keys(probs)) {
    const p = probs[id]
    if (p === undefined || p >= POLICY.suggestFloor) continue
    if (rec.groundTruth.some((truth) => isSibling(truth, id))) decoys.push([id, p])
  }
  // Curated decoys count toward the cap: red never floods.
  const curated = (CURATED_DECOYS[rec.fixtureId] ?? []).filter(
    (id) => probs[id] !== undefined && probs[id]! < POLICY.suggestFloor
  )
  const siblings = decoys
    .filter(([id]) => !curated.includes(id))
    .sort((a, b) => b[1] - a[1])
    .slice(0, Math.max(0, MAX_DECOYS - curated.length))
    .map(([id]) => id)
  return [...curated, ...siblings]
}

/** Capture date = the recording's git commit date (honest provenance, not mtime). */
function capturedAt(file: string): string | null {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%cs', '--', file], {
      cwd: ROOT,
      encoding: 'utf8'
    }).trim()
    return out || null
  } catch {
    return null
  }
}

async function main(): Promise<void> {
  const disk = new Map(loadSkills().map((s) => [s.id, s]))
  const files = (await readdir(RECORDINGS_DIR)).filter(
    (f) => f.endsWith('.json') && f !== 'doctor-probes.json'
  )

  const fixtures = []
  for (const file of files.sort()) {
    const rec: Recording = JSON.parse(await readFile(join(RECORDINGS_DIR, file), 'utf8'))
    // Labels come from fixtures/sessions.ts, their single source. A recording's
    // groundTruth is the capture-time copy and can predate a label correction.
    rec.groundTruth = SESSIONS.find((s) => s.id === rec.fixtureId)?.expected ?? rec.groundTruth
    if (rec.catalog === 'real' && rec.run) {
      const removed = Object.keys(rec.run.probabilities).filter((id) => DISPLAY_EXCLUDE.has(id))
      for (const id of removed) delete rec.run.probabilities[id]
      rec.run.selected = rec.run.selected.filter((id) => !DISPLAY_EXCLUDE.has(id))
      rec.run.judgedCount -= removed.length
      rec.catalogSize -= removed.length
    }
    const recordedRun = runFromEvalRecording(rec)
    if (!recordedRun || !rec.run) {
      console.warn(`skip ${file}: no probabilities to replay`)
      continue
    }

    const catalogIds = Object.keys(rec.run.probabilities)
    const catalog = skillsFromRecording(catalogIds, rec.catalog, disk)
    const byId = new Map(catalog.map((s) => [s.id, s]))
    const session: SessionState = { transcript: '', latestQuery: rec.query }

    // The real orchestrator end to end, judgment served from the capture.
    const judge = createRecordedJudge([recordedRun])
    const routed = await route(session, catalog, judge, POLICY)
    if (routed.judgedCount !== rec.run.judgedCount) {
      throw new Error(
        `${file}: replay judged ${routed.judgedCount}, capture judged ${rec.run.judgedCount}`
      )
    }
    const run: RunReplay = {
      rows: rankedRows(rec.run.probabilities),
      selected: routed.selected.map((s) => s.id),
      suggested: routed.suggested.map((s) => s.id),
      capturedSelected: rec.run.selected,
      judgedCount: rec.run.judgedCount,
      shards: rec.run.shards,
      latencyMs: rec.run.latencyMs
    }

    // The threshold test strip: one run, banded at stepped thresholds.
    const runScored = scoredFromRun(rec.run, byId)
    const testStrip = TEST_STRIP_THRESHOLDS.map((t) => {
      const banded = applyPolicy(runScored, { threshold: t, maxSelected: POLICY.maxSelected })
      return { threshold: t, selected: banded.selected.map((s) => s.id) }
    })

    const groundTruth =
      rec.catalog === 'real'
        ? [...new Set([...rec.groundTruth, ...(FIXTURE_TRUTH_EXTRA[rec.fixtureId] ?? [])])]
        : rec.groundTruth

    fixtures.push({
      id: rec.fixtureId,
      recordingFile: `fixtures/recordings/${file}`,
      capturedAt: capturedAt(join('fixtures', 'recordings', file)),
      catalog: rec.catalog,
      catalogSize: rec.catalogSize,
      query: rec.query,
      groundTruth,
      negativeControl: rec.negativeControl,
      captureThreshold: rec.threshold,
      decoys: computeDecoys(rec),
      run,
      testStrip
    })
  }

  // Real catalog leads (the demo's priority order); synthetic carries the scale story.
  // Within real: the mechanism's fixture first, then the two clearest exemplars,
  // then the rest alphabetically, with abstention controls (no truth in the judged
  // catalog) grouped at the very end.
  const PINNED_REAL = ['a11y-widget', 'radix-migration', 'swift-concurrency']
  const realRank = (f: { id: string; groundTruth: string[]; run: RunReplay }): string => {
    const pin = PINNED_REAL.indexOf(f.id)
    if (pin !== -1) return `0${pin}`
    const judged = new Set(f.run.rows.map(([id]) => id))
    const abstention = !f.groundTruth.some((id) => judged.has(id))
    if (abstention) return `2${f.id}`
    return `1${f.id}`
  }
  fixtures.sort((a, b) => {
    if (a.catalog !== b.catalog) return a.catalog === 'real' ? -1 : 1
    if (a.catalog !== 'real') return a.id.localeCompare(b.id)
    return realRank(a).localeCompare(realRank(b))
  })

  // Display dictionary: every real-catalog skill, plus the synthetic skills the page
  // can actually show (top rows, truth, decoys) — look-alike names need their
  // descriptions disclosable, but shipping all ~1,064 would triple the payload.
  const SYNTH_DISPLAY_ROWS = 20
  const synth = new Map(synthesizeCatalog().map((s) => [s.id, s]))
  const displayIds = new Set<string>()
  for (const f of fixtures) {
    if (f.catalog === 'real') for (const [id] of f.run.rows) displayIds.add(id)
    else {
      for (const [id] of f.run.rows.slice(0, SYNTH_DISPLAY_ROWS)) displayIds.add(id)
      for (const id of [...f.groundTruth, ...f.decoys, ...f.run.selected, ...f.run.suggested]) displayIds.add(id)
    }
  }
  const skills: Record<string, { name: string; description: string }> = {}
  for (const id of [...displayIds].sort()) {
    const s = disk.get(id) ?? synth.get(id)
    skills[id] = { name: s?.name ?? id, description: s?.description ?? '' }
  }

  await mkdir(dirname(OUT_FILE), { recursive: true })
  const payload = { policy: POLICY, testStripThresholds: TEST_STRIP_THRESHOLDS, skills, fixtures }
  await writeFile(OUT_FILE, JSON.stringify(payload))

  // Doctor display alignment — the same catalog curation as the fixtures above. The
  // raw sweep probed every installed skill; the displayed composition counts the
  // catalog with DISPLAY_EXCLUDE removed (neither id appears in any finding).
  // Recomputed from the raw recording so reruns are idempotent.
  const doctorFile = join(ROOT, 'web', 'data', 'doctor.json')
  const probesFile = join(ROOT, 'fixtures', 'recordings', 'doctor-probes.json')
  if (existsSync(doctorFile) && existsSync(probesFile)) {
    const doctor = JSON.parse(await readFile(doctorFile, 'utf8'))
    const probes = JSON.parse(await readFile(probesFile, 'utf8')) as {
      outcomes: { skillId: string }[]
    }
    const probed = probes.outcomes.map((o) => o.skillId)
    const kept = probed.filter((id) => !DISPLAY_EXCLUDE.has(id))
    const inSuite = new Set(
      (doctor.composition.suites as { members: string[] }[]).flatMap((s) => s.members)
    )
    doctor.composition.catalogSize = kept.length
    doctor.composition.standalone = kept.filter((id) => !inSuite.has(id)).length
    // The page is public: repo paths go relative and home paths go to ~, so no
    // machine-specific absolute path ships in the artifact.
    const published = JSON.stringify(doctor).split(`${ROOT}/`).join('').split(homedir()).join('~')
    await writeFile(doctorFile, published)
    console.log(`aligned ${doctorFile}: ${kept.length} displayed of ${probed.length} probed`)
  }
  const real = fixtures.filter((f) => f.catalog === 'real').length
  console.log(
    `wrote ${OUT_FILE}: ${fixtures.length} fixtures (${real} real, ${fixtures.length - real} synthetic), ` +
      `${Object.keys(skills).length} real skills`
  )
  for (const f of fixtures) {
    const drift =
      JSON.stringify([...f.run.selected].sort()) !== JSON.stringify([...f.run.capturedSelected].sort())
    if (drift) {
      console.log(
        `  note ${f.id} (${f.catalog}): current policy selects [${f.run.selected}] vs captured [${f.run.capturedSelected}]`
      )
    }
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
