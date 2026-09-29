// Measure the per-turn system-prompt token overhead that ALL installed skills add
// to a stock (no-router) Claude Code session.
//
// Enumerates personal (~/.claude/skills/), project (.claude/skills/), and plugin
// skills (~/.claude/plugins/cache/**), then reports:
//   (a) Total catalog footprint — tokens for all skill descriptions (system-prompt cost per turn)
//   (b) Per-skill SKILL.md body token distribution (min/median/max/total, top-10 largest)
//   (c) Skill count by source (personal / project / plugin)
//
// Token counting: uses chars/4 estimate (no API calls). Labeled clearly as estimate.
//
//   npx tsx scripts/skill-overhead.ts
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import matter from 'gray-matter'

// ---------------------------------------------------------------------------
// helpers

/** Rough token estimate: chars / 4 (GPT/Claude rule-of-thumb). */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 !== 0
    ? (sorted[mid] as number)
    : (((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2)
}

// ---------------------------------------------------------------------------
// skill sources

type Source = 'personal' | 'project' | 'plugin'

interface SkillEntry {
  id: string
  source: Source
  skillPath: string
  description: string
  descBytes: number
  descTokensEst: number
  bodyRaw: string        // full SKILL.md text (including frontmatter)
  bodyBytes: number
  bodyTokensEst: number
}

function readSkillDir(dir: string, source: Source): SkillEntry[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }

  const skills: SkillEntry[] = []
  for (const entry of entries) {
    const entryPath = join(dir, entry)
    try {
      if (!statSync(entryPath).isDirectory()) continue
    } catch {
      continue
    }
    const skillPath = join(entryPath, 'SKILL.md')
    let raw: string
    try {
      raw = readFileSync(skillPath, 'utf8')
    } catch {
      continue // no SKILL.md
    }

    const { data } = matter(raw)
    const description = typeof data.description === 'string' ? data.description.trim() : ''
    if (!description) continue // no description = not visible in catalog

    skills.push({
      id: entry,
      source,
      skillPath,
      description,
      descBytes: Buffer.byteLength(description, 'utf8'),
      descTokensEst: estimateTokens(description),
      bodyRaw: raw,
      bodyBytes: Buffer.byteLength(raw, 'utf8'),
      bodyTokensEst: estimateTokens(raw),
    })
  }
  return skills
}

/** Scan ~/.claude/plugins/cache for plugin skill directories. */
function readPluginSkills(): SkillEntry[] {
  const pluginCacheRoot = join(homedir(), '.claude', 'plugins', 'cache')
  const skills: SkillEntry[] = []

  // Structure: cache/<marketplace>/<plugin-name>/<version>/skills/<skill-name>/SKILL.md
  function walk(dir: string, depth: number) {
    if (depth > 6) return
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(dir, entry)
      try {
        if (!statSync(full).isDirectory()) continue
      } catch {
        continue
      }
      if (entry === 'skills' && depth >= 3) {
        // this is the skills/ folder — its children are skill directories
        const found = readSkillDir(full, 'plugin')
        skills.push(...found)
      } else {
        walk(full, depth + 1)
      }
    }
  }

  walk(pluginCacheRoot, 0)
  return skills
}

// ---------------------------------------------------------------------------
// main

const SCRIPT_DIR = resolve(dirname(fileURLToPath(import.meta.url)))
const REPO_ROOT = resolve(SCRIPT_DIR, '..')

const personalDir = join(homedir(), '.claude', 'skills')
const projectDir = join(REPO_ROOT, '.claude', 'skills')

const personal = readSkillDir(personalDir, 'personal')
const project = readSkillDir(projectDir, 'project')
const plugin = readPluginSkills()

// Merge: project overrides personal on id collision (Claude Code precedence),
// plugin skills have distinct namespacing so we keep them all.
const byId = new Map<string, SkillEntry>()
for (const s of personal) byId.set(s.id, s)
for (const s of project) byId.set(s.id, s)
// Plugins use scoped names (marketplace:skill) in practice, but their dir names
// may collide with personal skills. Keep them separate.
const pluginById = new Map<string, SkillEntry>()
for (const s of plugin) pluginById.set(s.id, s)

const allSkills: SkillEntry[] = [...byId.values(), ...pluginById.values()]

// ---------------------------------------------------------------------------
// (a) Catalog footprint — all descriptions

const totalDescChars = allSkills.reduce((s, x) => s + x.descBytes, 0)
const totalDescTokensEst = allSkills.reduce((s, x) => s + x.descTokensEst, 0)

// ---------------------------------------------------------------------------
// (b) Body token distribution

const bodyTokensSorted = allSkills.map((s) => s.bodyTokensEst).sort((a, b) => a - b)
const totalBodyTokensEst = bodyTokensSorted.reduce((s, x) => s + x, 0)
const minBody = bodyTokensSorted[0] ?? 0
const maxBody = bodyTokensSorted[bodyTokensSorted.length - 1] ?? 0
const medBody = median(bodyTokensSorted)

const top10 = [...allSkills].sort((a, b) => b.bodyTokensEst - a.bodyTokensEst).slice(0, 10)

// ---------------------------------------------------------------------------
// (c) Counts by source

const countPersonal = allSkills.filter((s) => s.source === 'personal').length
const countProject = allSkills.filter((s) => s.source === 'project').length
const countPlugin = allSkills.filter((s) => s.source === 'plugin').length

// ---------------------------------------------------------------------------
// output

console.log('=== skill-overhead.ts — stock session token footprint ===')
console.log('Token counting method: chars/4 (ESTIMATE — no API calls)')
console.log('')

console.log('(c) Skill count by source')
console.log(`  personal (~/.claude/skills/):           ${countPersonal}`)
console.log(`  project  (.claude/skills/ in repo):     ${countProject}`)
console.log(`  plugin   (~/.claude/plugins/cache/**):  ${countPlugin}`)
console.log(`  total (after id-collision dedup):        ${allSkills.length}`)
console.log('')

console.log('(a) Per-turn system-prompt catalog footprint (ALL skill descriptions)')
console.log(`  total description chars:  ${totalDescChars.toLocaleString()}`)
console.log(`  total description tokens: ~${totalDescTokensEst.toLocaleString()} (estimate)`)
console.log('')

console.log('(b) SKILL.md body token distribution (full file incl. frontmatter)')
console.log(`  min:    ~${minBody.toLocaleString()} tokens`)
console.log(`  median: ~${medBody.toLocaleString()} tokens`)
console.log(`  max:    ~${maxBody.toLocaleString()} tokens`)
console.log(`  total:  ~${totalBodyTokensEst.toLocaleString()} tokens  (on-invocation cost if ALL loaded at once)`)
console.log('')

console.log('  top 10 largest SKILL.md bodies:')
console.log(`  ${'rank'.padEnd(5)} ${'id'.padEnd(40)} ${'bytes'.padStart(8)} ${'~tokens'.padStart(9)}  source`)
for (let i = 0; i < top10.length; i++) {
  const s = top10[i]!
  console.log(
    `  ${String(i + 1).padEnd(5)} ${s.id.padEnd(40)} ${s.bodyBytes.toLocaleString().padStart(8)} ${('~' + s.bodyTokensEst.toLocaleString()).padStart(9)}  ${s.source}`
  )
}
console.log('')

console.log('  all skills (id, description tokens, body tokens, source):')
const allSorted = [...allSkills].sort((a, b) => a.id.localeCompare(b.id))
for (const s of allSorted) {
  console.log(
    `    ${s.id.padEnd(42)} desc ~${String(s.descTokensEst).padStart(4)}t  body ~${String(s.bodyTokensEst).padStart(6)}t  [${s.source}]`
  )
}
