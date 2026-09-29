// The one bin: `jev-skill-router <command>`. Subcommands are thin modules — this
// file only dispatches. Bundled by scripts/build.ts to dist/cli.mjs (the npm bin);
// in dev the npm scripts run it via tsx (`npm run route -- "..."`).
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HELP = `jev-skill-router — per-turn semantic skill routing for coding agents

Usage: jev-skill-router <command> [args]

Commands:
  route <query>     route a query against the installed skill catalog
  doctor            catalog health report (static findings + routing probes)
  install claude    register the router's hooks in Claude Code settings
  config            edit exclude / alwaysAllow in .skillrouter.json (config show)

Run \`jev-skill-router <command> --help\` for a command's flags.`

function version(): string {
  // package.json sits one level above both dist/cli.mjs and scripts/cli.ts.
  const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json')
  return (JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string }).version
}

const [cmd, ...rest] = process.argv.slice(2)
switch (cmd) {
  case 'route':
    await (await import('./route-cli.js')).main(rest)
    break
  case 'doctor':
    await (await import('./doctor-cli.js')).main(rest)
    break
  case 'install':
    await (await import('./install-cli.js')).main(rest)
    break
  case 'config':
    await (await import('./config-cli.js')).main(rest)
    break
  case '--version':
  case '-v':
    console.log(version())
    break
  case undefined:
  case '--help':
  case '-h':
    console.log(HELP)
    break
  default:
    console.error(`Unknown command "${cmd}".\n\n${HELP}`)
    process.exit(1)
}
