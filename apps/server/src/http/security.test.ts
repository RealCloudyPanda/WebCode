import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeAll, expect, test } from 'vitest'
import type { Hono } from 'hono'
import { loadConfig } from '../config.js'
import { createApp } from './app.js'
import { RateLimiter } from '../util/rate-limit.js'
import { createNoopCollab } from '../collab/types.js'
import type { GithubClient } from '../auth/github.js'
import type { Sql } from '../db/db.js'

let app: Hono
beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), 'webdist-'))
  writeFileSync(join(dir, 'index.html'), '<html>spa</html>')
  mkdirSync(join(dir, 'assets'))
  writeFileSync(join(dir, 'assets', 'index-AbC12345.js'), 'x')
  writeFileSync(join(dir, 'assets', 'plain.js'), 'x')
  const config = loadConfig({ WEB_DIST_DIR: dir, PUBLIC_URL: 'http://localhost:5173' })
  app = createApp({
    sql: {} as Sql, config, github: {} as GithubClient, collab: createNoopCollab(), limiter: new RateLimiter(),
  })
})

const post = (path: string, headers: Record<string, string>, body?: string) =>
  app.request(path, { method: 'POST', headers, body })
const okOrigin = 'http://localhost:5173'

test('isolation headers on SPA, API, 404 and static', async () => {
  for (const path of ['/', '/p/abc', '/api/health', '/api/nope', '/assets/plain.js']) {
    const r = await app.request(path)
    expect(r.headers.get('cross-origin-opener-policy')).toBe('same-origin')
    expect(r.headers.get('cross-origin-embedder-policy')).toBe('require-corp')
    expect(r.headers.get('cross-origin-resource-policy')).toBe('same-origin')
    expect(r.headers.get('x-content-type-options')).toBe('nosniff')
  }
})

test('health', async () => {
  const r = await app.request('/api/health')
  expect(await r.json()).toEqual({ ok: true })
})

test('SPA fallback and unknown api/auth', async () => {
  const r = await app.request('/p/abc')
  expect(r.status).toBe(200)
  expect(await r.text()).toContain('spa')
  const a = await app.request('/api/nope')
  expect(a.status).toBe(404)
  expect(await a.json()).toEqual({ error: 'not-found' })
  expect((await app.request('/auth/nope')).status).toBe(404)
})

test('cache headers', async () => {
  expect((await app.request('/')).headers.get('cache-control')).toBe('no-cache')
  expect((await app.request('/assets/index-AbC12345.js')).headers.get('cache-control')).toContain('immutable')
  expect((await app.request('/assets/plain.js')).headers.get('cache-control')).not.toContain('immutable')
})

test('POST with foreign Origin is 403', async () => {
  const r = await post('/api/projects', { origin: 'https://evil.test', 'content-type': 'application/json' }, '{}')
  expect(r.status).toBe(403)
  expect(await r.json()).toEqual({ error: 'bad-origin' })
})

test('POST with missing Origin is 403, also under /auth', async () => {
  expect((await post('/api/projects', { 'content-type': 'application/json' }, '{}')).status).toBe(403)
  expect((await post('/auth/logout', {})).status).toBe(403)
})

test('matching Origin passes the check', async () => {
  const r = await post('/api/projects', { origin: okOrigin, 'content-type': 'application/json' }, '{}')
  expect(r.status).toBe(404)
})

test('non-JSON body on /api is 415; empty body allowed', async () => {
  const r = await post('/api/projects', { origin: okOrigin, 'content-type': 'text/plain' }, 'hi')
  expect(r.status).toBe(415)
  expect(await r.json()).toEqual({ error: 'unsupported-media-type' })
  expect((await post('/api/demo', { origin: okOrigin })).status).toBe(404)
})

test('GET is not origin checked', async () => {
  expect((await app.request('/api/health', { headers: { origin: 'https://evil.test' } })).status).toBe(200)
})
