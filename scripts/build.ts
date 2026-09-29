// Bundle the distribution artifacts to dependency-free ESM in dist/ — the single
// prerequisite both install doors share: the npm bin runs dist/cli.mjs, the Claude
// Code plugin's hooks.json runs dist/hooks/*.mjs via ${CLAUDE_PLUGIN_ROOT}. dist/ is
// COMMITTED: plugin installs from a git marketplace never run a build step.
import { build } from 'esbuild'
import { statSync } from 'node:fs'

// CJS deps (gray-matter) require() node builtins; in ESM output that needs a
// createRequire shim. The shebang only matters for cli.mjs but is harmless elsewhere.
const banner = `#!/usr/bin/env node
import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);`

const targets = [
  { entry: 'scripts/cli.ts', out: 'dist/cli.mjs' },
  { entry: 'hooks/user-prompt-submit.ts', out: 'dist/hooks/user-prompt-submit.mjs' },
  { entry: 'hooks/pre-tool-use-gate.ts', out: 'dist/hooks/pre-tool-use-gate.mjs' }
]

for (const { entry, out } of targets) {
  await build({
    entryPoints: [entry],
    outfile: out,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    banner: { js: banner },
    logLevel: 'warning'
  })
  console.log(`${out}  ${(statSync(out).size / 1024).toFixed(0)}kB`)
}
