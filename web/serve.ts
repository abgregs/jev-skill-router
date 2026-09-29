import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join, normalize, extname } from 'node:path'

// Local preview only. The demo itself is a fully static artifact — this file exists
// because fetch() needs an http origin, not because the demo needs a server. Any
// static host serves web/ as-is; there is no API, no key, no judging here.

const __dirname = dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.env.PORT) || 8787

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png'
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)
  const pathname = url.pathname === '/' ? '/index.html' : url.pathname
  const rel = normalize(pathname).replace(/^([/\\])+/, '')
  const file = join(__dirname, rel)
  const type = TYPES[extname(file)]
  if (!file.startsWith(__dirname) || !type) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('Not found')
    return
  }
  try {
    const buf = await readFile(file)
    res.writeHead(200, { 'content-type': type })
    res.end(buf)
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('Not found')
  }
})

server.listen(PORT, () => {
  console.log(`jev-skill-router recorded demo → http://localhost:${PORT}  ·  static replay, no API`)
})
