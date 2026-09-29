import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import matter from 'gray-matter'
import type { Skill } from './types.js'

/**
 * Default skill roots, in Claude Code precedence order: personal first, then the
 * project's .claude/skills in the start directory and every parent up to the
 * repository root (the nearest directory holding .git; a worktree's .git file
 * counts). Outside a repository only the start directory is searched.
 */
export function defaultSkillRoots(cwd = process.cwd()): { dir: string; scope: 'global' | 'project' }[] {
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
    ...projectDirs.map((dir) => ({ dir: join(dir, '.claude', 'skills'), scope: 'project' as const }))
  ]
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

function readSkillDir(dir: string, scope: 'global' | 'project'): Skill[] {
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
    // The model is forbidden to invoke these (user-only skills), so a routing verdict
    // naming one is unactionable — keep them out of the judged catalog entirely.
    if (data['disable-model-invocation'] === true) continue

    skills.push({
      id: entry,
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
  reason: 'no-skill-md' | 'no-description'
}

/**
 * Scan a skill root for folders `loadSkills` silently skips: no SKILL.md, or a
 * SKILL.md whose frontmatter has no description. The loader drops these because
 * they cannot be routed on; the catalog doctor surfaces them because that's a
 * fault worth fixing, not a fact to hide.
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
    if (!description) unroutable.push({ id: entry, source: skillPath, reason: 'no-description' })
  }
  return unroutable
}

/**
 * Load real skills from disk. On an id collision the earlier root wins, so with
 * defaultSkillRoots() a personal skill shadows a same-named project skill, matching
 * Claude Code's precedence (personal over project).
 */
export function loadSkills(
  roots = defaultSkillRoots()
): Skill[] {
  const byId = new Map<string, Skill>()
  for (const { dir, scope } of roots) {
    for (const skill of readSkillDir(dir, scope)) {
      if (!byId.has(skill.id)) byId.set(skill.id, skill)
    }
  }
  return [...byId.values()]
}
