import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { loadSkills } from '../lib/skills/loadSkills.js'
process.loadEnvFile(new URL('../.env.local', import.meta.url).pathname)

// Intercept every request the SDK makes: capture URL, headers, and exact body bytes.
const realFetch = globalThis.fetch
const captured = []
globalThis.fetch = async (url, init) => {
  captured.push({ url: String(url), body: init?.body ?? null, headers: init?.headers ?? null })
  return realFetch(url, init)
}

const { createJevJudge } = await import('../lib/router/jevJudge.js')
const skills = loadSkills([{ dir: process.env.HOME + '/.claude/skills', scope: 'global' }])
const candidates = skills.filter((s) => ['brief', 'better-accessibility', 'diagnosing-bugs'].includes(s.id))
const session = {
  latestQuery: 'our custom combobox is broken for keyboard users and voiceover announces nothing — fix the focus management and aria wiring',
  transcript: ''
}
const judge = createJevJudge()

for (let i = 1; i <= 4; i++) {
  const r = await judge.judge({ session, candidates })
  const req = captured[captured.length - 1]
  const bodyStr = typeof req.body === 'string' ? req.body : JSON.stringify(req.body)
  const hash = createHash('sha256').update(bodyStr).digest('hex').slice(0, 16)
  writeFileSync(`/tmp/jev-body-${i}.json`, bodyStr)
  console.log(`call ${i}: bodyHash=${hash} bodyBytes=${bodyStr.length}  ` +
    [...r.probabilities.entries()].map(([k, v]) => `${k}=${v}`).join('  '))
}
console.log('url:', captured[0].url)
