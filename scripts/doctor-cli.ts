// `jev-skill-router doctor` — a health report for the installed skill catalog. Every
// finding names its evidence and exactly one action ("uninstall X", "add a 'not for Y'
// clause to Z", "add W to exclude") — never a wall of similarity scores.
//
//   npm run doctor                      # static findings + Jev probes (projects Noul cost first)
//   npm run doctor -- --judge mock      # free probes that see only lexical confusion
//   npm run doctor -- --no-probe        # static only: always free, no judge at all
//   npm run doctor -- --dry-run         # print the probe cost projection and exit
//   npm run doctor -- --json            # machine-readable report
//   npm run doctor -- --replay PATH     # reinterpret a recorded sweep — no API calls
//
// Paid (jev) sweeps auto-record raw probe probabilities to
// fixtures/recordings/doctor-probes.json (override with --record PATH; --record also
// forces recording on the mock judge). --only re-probes merge into the recording;
// --replay re-runs interpretation (any --threshold) against the captured data and
// warns per-probe when a judged description has changed since capture.
//
// Static findings (duplicates, unroutable folders, weak descriptions, stale config)
// are plain code — free. Overlap findings come from PROBES: each skill's own
// description is routed as a session, and co-invocation on that home territory is
// measured routing confusion. On the mock judge probes are free but only see
// lexical confusion; the umbrella collisions worth finding are semantic and need
// --judge jev (cost: one Noul per judged candidate, projected and capped like
// eval:capture via --max-nouls).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  composition,
  detectSuites,
  exemptPairs,
  mergeRecordedProbes,
  orderFindings,
  probeFindings,
  runProbes,
  staleRecordedProbes,
  staticFindings,
  toRecordedProbes
} from '../lib/doctor.js'
import type { DoctorConfig, DoctorRecording, Finding, ProbeOutcome } from '../lib/doctor.js'
import { expandHome, loadConfigFile, stringList } from '../lib/config.js'
import { createJudgeByName, RouterSetupError } from '../lib/router/runRoute.js'
import { loadSkills, routableSkillIds, scanUnroutable } from '../lib/skills/loadSkills.js'
import { DEFAULT_ROUTE_OPTIONS } from '../lib/skills/types.js'
import type { JevJudge } from '../lib/router/judge.js'

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

const USAGE =
  'Usage: jev-skill-router doctor [--skills-dir DIR] [--judge mock|jev] [--threshold N] ' +
  '[--no-probe] [--dry-run] [--only a,b] [--max-nouls N] [--record PATH] [--replay PATH] [--config PATH] [--json]'

export async function main(argv: string[]): Promise<void> {
  const { opts, bools } = parseArgs(argv)
  if (bools.has('help')) {
    console.log(USAGE)
    return
  }

  let cfg: Record<string, unknown>
  try {
    cfg = loadConfigFile(opts.config)
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  }

  const skillsDir = expandHome(
    opts['skills-dir'] ??
      process.env.SKILLS_DIR ??
      (typeof cfg.skillsDir === 'string' ? cfg.skillsDir : '~/.agents/skills')
  )
  const doctorConfig: DoctorConfig = {
    alwaysAllow: stringList(cfg.alwaysAllow),
    exclude: stringList(cfg.exclude)
  }
  const threshold =
    opts.threshold !== undefined
      ? Number(opts.threshold)
      : typeof cfg.threshold === 'number'
        ? cfg.threshold
        : DEFAULT_ROUTE_OPTIONS.threshold
  const maxNouls = opts['max-nouls'] !== undefined ? Number(opts['max-nouls']) : 3000
  // --only a,b,c probes just those skills (still against the full catalog) — for
  // cheap re-checks after editing a description, without re-paying the full sweep.
  const only = opts.only?.split(',').map((s) => s.trim()).filter(Boolean)

  const installed = loadSkills([{ dir: skillsDir, scope: 'global' }])
  if (installed.length === 0) {
    console.error(`No skills found in ${skillsDir}. Point --skills-dir at a folder of <slug>/SKILL.md skills.`)
    process.exit(1)
  }
  const excluded = installed.filter((s) => doctorConfig.exclude.includes(s.id)).map((s) => s.id)
  // Excluded skills never reach the router, so they can't collide — analyze the rest.
  const skills = installed.filter((s) => !excluded.includes(s.id))
  const unroutable = scanUnroutable(skillsDir)

  const { findings: staticF, duplicatePairs } = staticFindings(
    skills,
    unroutable,
    doctorConfig,
    routableSkillIds(skillsDir)
  )
  const findings: Finding[] = [...staticF]

  // ---- Probe layer -----------------------------------------------------------------
  const probing = !bools.has('no-probe')
  const replayPath = opts.replay ? expandHome(opts.replay) : undefined
  const judgeName = opts.judge ?? (cfg.judge === 'jev' || cfg.judge === 'mock' ? cfg.judge : 'jev')
  const probeSkills = only ? skills.filter((s) => only.includes(s.id)) : skills
  if (only && !replayPath && probeSkills.length !== only.length) {
    const missing = only.filter((id) => !probeSkills.some((s) => s.id === id))
    console.error(`--only names skills not in the catalog: ${missing.join(', ')}`)
    process.exit(1)
  }
  const projectedNouls = probeSkills.length * skills.length

  if (probing && !replayPath && judgeName === 'jev') {
    // stderr: progress/cost lines must never corrupt --json output on stdout.
    console.error(
      `doctor probes — projected REAL Noul spend: ${probeSkills.length} probes × ${skills.length} ` +
        `catalog skills = ${projectedNouls} Nouls  (cap --max-nouls=${maxNouls})`
    )
    if (bools.has('dry-run')) {
      console.error('Dry run — no API calls made.')
      process.exit(0)
    }
    if (projectedNouls > maxNouls) {
      console.error(
        `Projected ${projectedNouls} Nouls exceeds --max-nouls ${maxNouls}. Probe fewer skills ` +
          `(--only a,b,c), use --no-probe, or raise --max-nouls deliberately.`
      )
      process.exit(1)
    }
  } else if (bools.has('dry-run')) {
    console.error(
      `Dry run — probes would be free (${!probing ? 'probes disabled' : replayPath ? 'replaying a recording' : `judge=${judgeName}`}).`
    )
    process.exit(0)
  }

  /** Judge label for the report: the judge that PRODUCED the probabilities. */
  let probeJudge: string | null = null

  function interpret(outcomes: ProbeOutcome[]): void {
    const exempt = exemptPairs(skills, detectSuites(skills))
    const analysis = probeFindings(outcomes, exempt, duplicatePairs, doctorConfig, threshold)
    findings.push(...analysis.findings)
    if (analysis.inconclusive.length > 0) {
      console.error(
        `note: ${analysis.inconclusive.length}/${outcomes.length} probes inconclusive ` +
          `(skill didn't fire on its own territory) — no overlap conclusions drawn from those`
      )
    }
  }

  if (probing && replayPath) {
    let recording: DoctorRecording
    try {
      recording = JSON.parse(readFileSync(replayPath, 'utf8')) as DoctorRecording
    } catch {
      console.error(`Cannot read recording: ${replayPath}`)
      process.exit(1)
    }
    if (recording.kind !== 'doctor-probes') {
      console.error(`${replayPath} is not a doctor-probes recording.`)
      process.exit(1)
    }
    let recorded = recording.outcomes
    if (only) {
      const missing = only.filter((id) => !recorded.some((o) => o.skillId === id))
      if (missing.length > 0) {
        console.error(`--only names skills not in the recording: ${missing.join(', ')}`)
        process.exit(1)
      }
      recorded = recorded.filter((o) => only.includes(o.skillId))
    }
    const { stale, removed } = staleRecordedProbes(recorded, skills)
    if (removed.length > 0) {
      const skippedExcluded = removed.filter((id) => excluded.includes(id))
      const uninstalled = removed.filter((id) => !excluded.includes(id))
      if (skippedExcluded.length > 0) console.error(`note: skipping probes of excluded skills: ${skippedExcluded.join(', ')}`)
      if (uninstalled.length > 0) console.error(`note: skipping probes of uninstalled skills: ${uninstalled.join(', ')}`)
      recorded = recorded.filter((o) => !removed.includes(o.skillId))
    }
    if (stale.length > 0) {
      console.error(
        `WARNING: descriptions changed since capture for probes of: ${stale.join(', ')} — ` +
          `their probabilities predate the edits; re-probe with --only ${stale.join(',')}`
      )
    }
    // Candidates uninstalled since capture must not surface in findings.
    const currentIds = new Set(skills.map((s) => s.id))
    const outcomes: ProbeOutcome[] = recorded.map((o) => ({
      skillId: o.skillId,
      probabilities: Object.fromEntries(Object.entries(o.probabilities).filter(([id]) => currentIds.has(id)))
    }))
    console.error(
      `replaying ${outcomes.length} probes from ${replayPath} (judge=${recording.judge}, captured ${recording.capturedAt}) — no API calls`
    )
    probeJudge = recording.judge
    interpret(outcomes)
  } else if (probing) {
    let judge: JevJudge
    try {
      judge = await createJudgeByName(judgeName)
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err))
      if (err instanceof RouterSetupError) console.error('Or pass --no-probe for the free static findings only.')
      process.exit(1)
    }

    const outcomes = await runProbes(probeSkills, skills, judge)
    probeJudge = judgeName

    // Paid probabilities must never evaporate with the terminal: jev runs always
    // record (--record overrides the path and also forces recording on mock).
    if (judgeName === 'jev' || opts.record !== undefined) {
      const recordPath = expandHome(opts.record ?? 'fixtures/recordings/doctor-probes.json')
      const fresh = toRecordedProbes(outcomes, skills)
      let all = fresh
      if (existsSync(recordPath)) {
        try {
          const prev = JSON.parse(readFileSync(recordPath, 'utf8')) as DoctorRecording
          // Merge only into a compatible recording — never mix judges or catalogs.
          if (prev.kind === 'doctor-probes' && prev.judge === judgeName && prev.skillsDir === skillsDir) {
            all = mergeRecordedProbes(prev.outcomes, fresh)
          }
        } catch {
          // unreadable previous recording — overwrite it
        }
      }
      const recording: DoctorRecording = {
        kind: 'doctor-probes',
        capturedAt: new Date().toISOString(),
        skillsDir,
        judge: judgeName,
        outcomes: all
      }
      mkdirSync(dirname(recordPath), { recursive: true })
      writeFileSync(recordPath, JSON.stringify(recording, null, 2))
      console.error(
        `recorded ${fresh.length} probe(s) → ${recordPath}` +
          (all.length !== fresh.length ? ` (merged into ${all.length} total)` : '')
      )
    }

    interpret(outcomes)
  }

  // ---- Report ----------------------------------------------------------------------
  const comp = composition(skills, excluded)
  const ordered = orderFindings(findings)

  if (bools.has('json')) {
    console.log(
      JSON.stringify(
        {
          skillsDir,
          judge: probeJudge,
          replay: replayPath ?? null,
          threshold,
          composition: comp,
          findings: ordered
        },
        null,
        2
      )
    )
    process.exit(0)
  }

  const suiteSummary = comp.suites.map((s) => `${s.prefix}-* (${s.members.length})`).join(' · ')
  console.log(`\nroute doctor — ${skillsDir}`)
  console.log(
    `Catalog: ${comp.catalogSize} skills` +
      (excluded.length ? ` (+${excluded.length} excluded: ${excluded.join(', ')})` : '') +
      ` · ${comp.standalone} standalone` +
      (suiteSummary ? ` · suites: ${suiteSummary}` : '') +
      ` · median routing surface ${comp.medianKeywords} keywords`
  )
  console.log(
    probing
      ? `Overlap measured by routing probes: judge=${probeJudge}${replayPath ? ' (replayed)' : ''}, t=${threshold}` +
          (probeJudge === 'mock' ? '  (mock sees only lexical confusion — use --judge jev for semantic overlap)' : '')
      : 'Probes disabled (--no-probe): static findings only'
  )

  if (ordered.length === 0) {
    console.log('\nNo findings — the catalog routes clean.')
    process.exit(0)
  }

  console.log(`\nFINDINGS (${ordered.length})\n`)
  const TAG: Record<string, string> = {
    unroutable: 'UNROUTABLE',
    'stale-config': 'STALE CONFIG',
    duplicate: 'DUPLICATE',
    collision: 'COLLISION',
    overlap: 'OVERLAP',
    'self-miss': 'SELF-MISS',
    'weak-description': 'WEAK'
  }
  ordered.forEach((f, i) => {
    const head =
      f.kind === 'collision'
        ? f.skills.join(' ↔ ')
        : f.kind === 'duplicate'
          ? f.skills.join(' ≡ ')
          : f.kind === 'overlap'
            ? (f.skills[0] as string)
            : f.skills.join(', ')
    console.log(`${String(i + 1).padStart(2)}. ${TAG[f.kind]}  ${head}`)
    console.log(`    evidence: ${f.evidence}`)
    console.log(`    action:   ${f.action}\n`)
  })
}
