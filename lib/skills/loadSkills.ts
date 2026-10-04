import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import matter from 'gray-matter'
import type { Skill } from './types.js'

/** A folder of <slug>/SKILL.md skills; a `synced` root holds claude.ai account buckets. */
export interface SkillRoot {
  dir: string
  scope: 'global' | 'project' | 'synced'
}

// Claude Code downloads claude.ai skills into ~/.claude/skills/synced/<account>/<slug>/
// and loads them under this reserved namespace (e.g. anthropic-skills:pdf).
const SYNCED_FOLDER = 'synced'
export const SYNCED_NAMESPACE = 'anthropic-skills'

/**
 * Default skill roots, in Claude Code precedence order: personal first, then the
 * project's .claude/skills in the start directory and every parent up to the
 * repository root (the nearest directory holding .git; a worktree's .git file
 * counts), then skills synced from claude.ai. Outside a repository only the start
 * directory is searched.
 */
export function defaultSkillRoots(cwd = process.cwd()): SkillRoot[] {
  const projectDirs: string[] = []
  for (let dir = resolve(cwd); ; dir = dirname(dir)) {
    projectDirs.push(dir)
    if (existsSync(join(dir, '.git'))) break
    if (dirname(dir) === dir) {
      projectDirs.splice(1) // no repository root above: the start directory only
      break
    }
  }
  return [
    { dir: join(homedir(), '.claude', 'skills'), scope: 'global' },
    ...projectDirs.map((dir) => ({ dir: join(dir, '.claude', 'skills'), scope: 'project' as const })),
    { dir: join(homedir(), '.claude', 'skills', SYNCED_FOLDER), scope: 'synced' }
  ]
}

/**
 * Every skill id the router can judge from `cwd`: the Claude Code layers plus the
 * route CLI's own `cliDir`, before any exclude list applies. A config entry naming
 * one of these is live, not stale.
 */
export function routableSkillIds(cliDir: string, cwd = process.cwd()): Set<string> {
  return new Set(loadSkills([...defaultSkillRoots(cwd), { dir: cliDir, scope: 'global' }]).map((s) => s.id))
}

/** Claude Code's own folders inside a skills root: the synced container and dot-folders like .trash. */
function isHostFolder(entry: string): boolean {
  return entry === SYNCED_FOLDER || entry.startsWith('.')
}

// Common English + Markdown noise we don't want polluting the keyword index.
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'to', 'of', 'in', 'on', 'for', 'with', 'when',
  'use', 'used', 'using', 'this', 'that', 'these', 'those', 'is', 'are', 'be',
  'it', 'its', 'as', 'at', 'by', 'from', 'into', 'your', 'you', 'user', 'skill',
  'also', 'e', 'g', 'eg', 'etc', 'via', 'over', 'any'
])

/** Lowercase and split text into content tokens, dropping stopwords and noise. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9+#]+/) // keeps tokens like c++, c#
    .filter((t) => t.length > 1 && !STOPWORDS.has(t))
}

/** Derive de-duplicated keyword tokens from a skill's name + description. */
export function deriveKeywords(name: string, description: string): string[] {
  return [...new Set(tokenize(`${name} ${description}`))]
}

// The model is forbidden to invoke these (user-only skills), so a routing verdict
// naming one is unactionable — keep them out of the judged catalog entirely.
const isUserOnly = (data: Record<string, unknown>) => data['disable-model-invocation'] === true

function readSkillDir(dir: string, scope: SkillRoot['scope'], idPrefix = ''): Skill[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return [] // root doesn't exist (e.g. no project-scoped skills) — not an error
  }

  const skills: Skill[] = []
  for (const entry of entries) {
    const skillPath = join(dir, entry, 'SKILL.md')
    let raw: string
    try {
      if (!statSync(join(dir, entry)).isDirectory()) continue
      raw = readFileSync(skillPath, 'utf8')
    } catch {
      continue // no SKILL.md in this folder
    }

    const { data } = matter(raw)
    const name = typeof data.name === 'string' ? data.name : entry
    const description = typeof data.description === 'string' ? data.description.trim() : ''
    if (!description) continue // a skill with no description can't be routed on
    if (isUserOnly(data)) continue

    skills.push({
      id: `${idPrefix}${entry}`,
      name,
      description,
      scope,
      source: skillPath,
      keywords: deriveKeywords(name, description)
    })
  }
  return skills
}

/** A catalog folder the router cannot route on — invisible to every routing decision. */
export interface UnroutableEntry {
  id: string
  source: string
  reason: 'no-skill-md' | 'no-description' | 'user-only'
}

/**
 * Scan a skill root for folders `loadSkills` silently skips: no SKILL.md, a
 * SKILL.md whose frontmatter has no description, or a user-only skill
 * (`disable-model-invocation: true`). The loader drops these because they cannot
 * be routed on; the catalog doctor surfaces them — the first two as faults worth
 * fixing, user-only skills as a count, since skipping them is by design.
 */
export function scanUnroutable(dir: string): UnroutableEntry[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }

  const unroutable: UnroutableEntry[] = []
  for (const entry of entries) {
    if (isHostFolder(entry)) continue // Claude Code's own folder, not a skill
    const skillPath = join(dir, entry, 'SKILL.md')
    try {
      if (!statSync(join(dir, entry)).isDirectory()) continue
    } catch {
      continue
    }
    let raw: string
    try {
      raw = readFileSync(skillPath, 'utf8')
    } catch {
      unroutable.push({ id: entry, source: join(dir, entry), reason: 'no-skill-md' })
      continue
    }
    const { data } = matter(raw)
    const description = typeof data.description === 'string' ? data.description.trim() : ''
    // User-only first: adding a description would not make one routable.
    if (isUserOnly(data)) unroutable.push({ id: entry, source: skillPath, reason: 'user-only' })
    else if (!description) unroutable.push({ id: entry, source: skillPath, reason: 'no-description' })
  }
  return unroutable
}

/** Account bucket folders under a synced root (dot entries like .staging skipped). */
function syncedBuckets(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((entry) => !entry.startsWith('.') && statSync(join(dir, entry)).isDirectory())
      .map((entry) => join(dir, entry))
  } catch {
    return [] // no synced skills on this machine
  }
}

/**
 * Load real skills from disk. On an id collision the earlier root wins, so with
 * defaultSkillRoots() a personal skill shadows a same-named project skill, matching
 * Claude Code's precedence (personal over project). Synced skills carry the
 * anthropic-skills: namespace, so they never collide with local ids.
 */
export function loadSkills(
  roots = defaultSkillRoots()
): Skill[] {
  const byId = new Map<string, Skill>()
  for (const { dir, scope } of roots) {
    const found =
      scope === 'synced'
        ? syncedBuckets(dir).flatMap((bucket) => readSkillDir(bucket, 'synced', `${SYNCED_NAMESPACE}:`))
        : readSkillDir(dir, scope)
    for (const skill of found) {
      if (!byId.has(skill.id)) byId.set(skill.id, skill)
    }
  }
  return [...byId.values()]
}
