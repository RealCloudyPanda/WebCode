import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'
import { Hono } from 'hono'
import type { Config } from '../config.js'
import type { Sql } from '../db/db.js'
import type { GithubClient } from '../auth/github.js'
import type { CollabHub } from '../collab/types.js'
import type { RateLimiter } from '../util/rate-limit.js'
import { isolationHeaders, originCheck, requireJson } from './security.js'

export type Deps = {
  sql: Sql
  config: Config
  github: GithubClient
  collab: CollabHub
  limiter: RateLimiter
  now?: () => Date
  onSignedIn?: (e: { userId: string; guest: { guestId: string; name: string } | null; next: string | null }) => Promise<void>
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.wasm': 'application/wasm', '.txt': 'text/plain; charset=utf-8',
}

const HASHED = /[.-][A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/

function safeDecode(path: string): string {
  try { return decodeURIComponent(path) } catch { return '/' }
}

async function readFileIfExists(path: string): Promise<Buffer | null> {
  try {
    if (!(await stat(path)).isFile()) return null
    return await readFile(path)
  } catch {
    return null
  }
}

export function createApp(deps: Deps): Hono {
  const { config } = deps
  const app = new Hono()

  app.use('*', isolationHeaders())
  app.use('/api/*', originCheck(config.publicUrl))
  app.use('/auth/*', originCheck(config.publicUrl))
  app.use('/api/*', requireJson())

  app.get('/api/health', c => c.json({ ok: true }))

  app.all('/api/*', c => c.json({ error: 'not-found' }, 404))
  app.all('/auth/*', c => c.json({ error: 'not-found' }, 404))

  app.get('*', async c => {
    const root = normalize(config.webDistDir)
    const rel = normalize(safeDecode(c.req.path)).replace(/^[/\\]+/, '')
    const target = join(root, rel)
    let file: Buffer | null = null
    let name = 'index.html'
    if (rel && (target === root || target.startsWith(root + sep))) {
      file = await readFileIfExists(target)
      if (file) name = rel
    }
    if (!file) {
      if (extname(c.req.path)) return c.json({ error: 'not-found' }, 404)
      file = await readFileIfExists(join(root, 'index.html'))
      if (!file) return c.json({ error: 'not-found' }, 404)
      name = 'index.html'
    }
    const isIndex = name === 'index.html'
    return new Response(new Uint8Array(file), {
      headers: {
        'content-type': MIME[extname(name).toLowerCase()] ?? 'application/octet-stream',
        'cache-control': !isIndex && HASHED.test(name) ? 'public, max-age=31536000, immutable' : 'no-cache',
      },
    })
  })

  return app
}
