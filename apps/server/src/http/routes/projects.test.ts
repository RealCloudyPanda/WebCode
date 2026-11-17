import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Sql } from 'postgres'
import type { Hono } from 'hono'
import { dbSkipReason, setupTestDb, TEST_DB_URL } from '../../../test/db-helpers'
import { loadConfig } from '../../config.js'
import { createApp } from '../app.js'
import { RateLimiter } from '../../util/rate-limit.js'
import { createNoopCollab, type CollabHub } from '../../collab/types.js'
import { GithubNotFound, type GithubClient } from '../../auth/github.js'
import { gzipSync } from 'node:zlib'
import tar from 'tar-stream'
import * as Y from 'yjs'
import { docToFiles } from '@webcode/shared'
import { signGuest } from '../../auth/guest.js'
import { createSession } from '../../db/sessions.js'
import { upsertGithubUser } from '../../db/users.js'
import { loadDoc } from '../../db/docs.js'
import { storeDoc } from '../../db/docs.js'
import { insertProject } from '../../db/projects.js'

const ORIGIN = 'http://localhost:5173'
const SECRET = 'test-secret'

describe.skipIf(!TEST_DB_URL)(`projects routes (${TEST_DB_URL ? 'postgres' : dbSkipReason})`, () => {
  let sql: Sql
  let teardown: () => Promise<void>
  let app: Hono
  let limiter: RateLimiter
  let hub: CollabHub & Record<string, any>
  const github = {} as GithubClient

  const mkHub = () => {
    const base = createNoopCollab()
    return {
      ...base,
      liveCount: vi.fn(() => 0),
      liveGuests: vi.fn(() => 2),
      reevaluateAccess: vi.fn(async () => {}),
      closeAll: vi.fn(),
      setTitle: vi.fn(async () => {}),
      snapshotFiles: vi.fn(async () => ({ 'a.txt': 'copied' })),
    }
  }
  const build = () => {
    limiter = new RateLimiter()
    hub = mkHub()
    app = createApp({
      sql, config: loadConfig({ PUBLIC_URL: ORIGIN, SESSION_SECRET: SECRET }), github,
      collab: hub, limiter,
    })
  }

  let n = 100
  const mkUser = async (login: string) => {
    const u = await upsertGithubUser(sql, { githubId: n++, login, name: login.toUpperCase(), avatarUrl: 'x' })
    const s = await createSession(sql, u.id)
    return { id: u.id, cookie: `wc_session=${s.id}` }
  }
  const guest = { id: 'g1', cookie: `wc_guest=${encodeURIComponent(signGuest({ guestId: 'g1', name: 'Guest' }, SECRET))}` }
  const anon = { id: '', cookie: '' }

  const req = (method: string, path: string, who: { cookie: string }, body?: unknown) =>
    app.request(path, {
      method,
      headers: { origin: ORIGIN, cookie: who.cookie, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
  const get = (p: string, w: { cookie: string }) => req('GET', p, w)
  const getJson = async (p: string, w: { cookie: string }) => (await get(p, w)).json() as Promise<any>
  const postJson = (p: string, b: unknown, w: { cookie: string }) => req('POST', p, w, b)
  const patchJson = (p: string, b: unknown, w: { cookie: string }) => req('PATCH', p, w, b)
  const del = (p: string, w: { cookie: string }) => req('DELETE', p, w)

  let alice: Awaited<ReturnType<typeof mkUser>>
  let bob: typeof alice
  beforeAll(async () => { ({ sql, teardown } = await setupTestDb()) })
  afterAll(async () => { await teardown?.() })
  beforeEach(async () => {
    await sql`delete from projects`
    build()
    alice = await mkUser('alice' + n)
    bob = await mkUser('bob' + n)
  })

  const create = async (who = alice, template = 'ts-library') =>
    ((await (await postJson('/api/projects', { template }, who)).json()) as any).id as string

  test('GET /api/templates lists templates', async () => {
    const r = await getJson('/api/templates', anon)
    expect(r.map((t: any) => t.name)).toEqual(['blank', 'react-app', 'node-api', 'ts-library'])
  })

  test('create from template then list shows it; doc stored, title defaults to label', async () => {
    const id = await create()
    const list = await getJson('/api/projects?filter=mine', alice)
    expect(list.map((p: any) => p.id)).toContain(id)
    expect(list[0]).toMatchObject({ title: 'TS library', isOwner: true, starred: false, liveCount: 0 })
    expect(typeof list[0].lastOpenedAt).toBe('string')
    expect(await loadDoc(sql, id)).not.toBeNull()
    const blank = await create(alice, 'blank')
    expect((await getJson(`/api/projects/${blank}`, alice)).title).toBe('Untitled project')
  })

  test('list requires sign-in', async () => {
    expect((await get('/api/projects', anon)).status).toBe(401)
    expect((await get('/api/projects', guest)).status).toBe(401)
  })

  test('invalid body and importUrl', async () => {
    expect((await postJson('/api/projects', { template: 'nope' }, alice)).status).toBe(400)
    expect((await postJson('/api/projects', {}, alice)).status).toBe(400)
    const r = await postJson('/api/projects', { importUrl: 'nope' }, alice)
    expect(r.status).toBe(400)
    expect(await r.json()).toEqual({ error: 'invalid', message: 'Enter a GitHub repo like owner/repo' })
  })

  test('import creates a project from the repo tarball', async () => {
    const pack = tar.pack()
    const chunks: Buffer[] = []
    pack.on('data', c => chunks.push(c as Buffer))
    const ended = new Promise<void>(res => pack.on('end', () => res()))
    pack.entry({ name: 'app-abc123/src/a.ts' }, 'export const a = 1')
    pack.entry({ name: 'app-abc123/README.md' }, '# hi')
    pack.entry({ name: 'app-abc123/node_modules/x.js' }, 'x')
    pack.finalize()
    await ended
    const calls: unknown[][] = []
    ;(github as any).downloadTarball = async (...a: unknown[]) => { calls.push(a); return new Uint8Array(gzipSync(Buffer.concat(chunks))) }
    const r = await postJson('/api/projects', { importUrl: 'https://github.com/octo/app/tree/dev' }, alice)
    expect(r.status).toBe(200)
    expect(calls).toEqual([['octo', 'app', 'dev']])
    const { id } = await r.json() as { id: string }
    const d = await getJson(`/api/projects/${id}`, alice)
    expect(d.title).toBe('app')
    expect(d.linkAccess).toBe('restricted')
    const state = await loadDoc(sql, id)
    const ydoc = new Y.Doc()
    Y.applyUpdate(ydoc, state!)
    expect(docToFiles(ydoc)).toEqual({ 'src/a.ts': 'export const a = 1', 'README.md': '# hi' })
    const [row] = await sql`select template from projects where id = ${id}`
    expect(row!.template).toBe('import')
  })

  test('import maps 404 to a friendly 400', async () => {
    ;(github as any).downloadTarball = async () => { throw new GithubNotFound() }
    const r = await postJson('/api/projects', { importUrl: 'octo/private' }, alice)
    expect(r.status).toBe(400)
    expect(await r.json()).toEqual({ error: 'not-found', message: 'Repo not found or private' })
  })

  test('import is counted by the create rate limit', async () => {
    ;(github as any).downloadTarball = async () => { throw new GithubNotFound() }
    for (let i = 0; i < 10; i++) await postJson('/api/projects', { importUrl: 'octo/x' }, alice)
    expect((await postJson('/api/projects', { importUrl: 'octo/x' }, alice)).status).toBe(429)
  })

  test('restricted project is 403 for others, viewer link works for guest', async () => {
    const id = await create()
    expect((await get(`/api/projects/${id}`, bob)).status).toBe(403)
    expect((await patchJson(`/api/projects/${id}`, { linkAccess: 'viewer' }, alice)).status).toBe(200)
    expect((await getJson(`/api/projects/${id}`, guest)).role).toBe('viewer')
    expect((await getJson(`/api/projects/${id}`, anon)).role).toBe('viewer')
    expect(hub.reevaluateAccess).toHaveBeenCalledWith(id)
  })

  test('detail: 404, people ordering, guestCount, bob gets membership', async () => {
    expect((await get('/api/projects/missing', alice)).status).toBe(404)
    const id = await create()
    await patchJson(`/api/projects/${id}`, { linkAccess: 'editor' }, alice)
    const d = await getJson(`/api/projects/${id}`, bob)
    expect(d).toMatchObject({ id, role: 'editor', linkAccess: 'editor', isDemoCopy: false, expiresAt: null, guestCount: 2 })
    const d2 = await getJson(`/api/projects/${id}`, alice)
    expect(d2.role).toBe('owner')
    expect(d2.people.map((p: any) => p.role)).toEqual(['owner', 'editor'])
    expect((await getJson('/api/projects?filter=shared', bob)).map((p: any) => p.id)).toEqual([id])
  })

  test('only owner changes link access', async () => {
    const id = await create()
    await patchJson(`/api/projects/${id}`, { linkAccess: 'editor' }, alice)
    expect((await patchJson(`/api/projects/${id}`, { linkAccess: 'restricted' }, bob)).status).toBe(403)
    expect((await patchJson(`/api/projects/${id}`, { linkAccess: 'bogus' }, alice)).status).toBe(400)
  })

  test('rename goes through collab.setTitle; validation; viewers cannot rename', async () => {
    const id = await create()
    const r = await patchJson(`/api/projects/${id}`, { title: '  New name  ' }, alice)
    expect((await r.json() as any).title).toBe('New name')
    expect(hub.setTitle).toHaveBeenCalledWith(id, 'New name')
    expect((await patchJson(`/api/projects/${id}`, { title: '   ' }, alice)).status).toBe(400)
    expect((await patchJson(`/api/projects/${id}`, { title: 'x'.repeat(101) }, alice)).status).toBe(400)
    await patchJson(`/api/projects/${id}`, { linkAccess: 'viewer' }, alice)
    expect((await patchJson(`/api/projects/${id}`, { title: 'hax' }, bob)).status).toBe(403)
  })

  test('star toggles for members; guests 401', async () => {
    const id = await create()
    await patchJson(`/api/projects/${id}`, { starred: true }, alice)
    expect((await getJson('/api/projects', alice))[0].starred).toBe(true)
    await patchJson(`/api/projects/${id}`, { linkAccess: 'viewer' }, alice)
    expect((await patchJson(`/api/projects/${id}`, { starred: true }, guest)).status).toBe(401)
  })

  test('21st project is refused', async () => {
    for (let i = 0; i < 20; i++) {
      build_limiter()
      expect((await postJson('/api/projects', { template: 'blank' }, alice)).status).toBe(200)
    }
    const r = await postJson('/api/projects', { template: 'blank' }, alice)
    expect(r.status).toBe(409)
    expect(await r.json()).toEqual({ error: 'project-limit', message: 'You can have up to 20 projects' })
  })
  // swaps in a fresh limiter so the 10/hour cap does not interfere with the project-count test
  const build_limiter = () => { app = createApp({
    sql, config: loadConfig({ PUBLIC_URL: ORIGIN, SESSION_SECRET: SECRET }), github, collab: hub, limiter: new RateLimiter(),
  }) }

  test('rate limit: 11th create in an hour is 429', async () => {
    for (let i = 0; i < 10; i++) expect((await postJson('/api/projects', { template: 'blank' }, alice)).status).toBe(200)
    const r = await postJson('/api/projects', { template: 'blank' }, alice)
    expect(r.status).toBe(429)
    expect((await r.json() as any).message).toBe('Too many new projects. Try again later.')
  })

  test('site full', async () => {
    const owner = await mkUser('big' + n)
    const p = await insertProject(sql, { ownerId: owner.id, title: 't', template: 'blank', linkAccess: 'restricted' })
    await storeDoc(sql, p.id, new Uint8Array(10), '', 't')
    await sql`update project_docs set stored_bytes = 400000000 where project_id = ${p.id}`
    const r = await postJson('/api/projects', { template: 'blank' }, alice)
    expect(r.status).toBe(503)
    expect((await r.json() as any).message).toBe('Webcode is full right now')
  })

  test('guests cannot create', async () => {
    expect((await postJson('/api/projects', { template: 'blank' }, guest)).status).toBe(401)
    expect((await postJson('/api/projects', { template: 'blank' }, anon)).status).toBe(401)
  })

  test('owner delete closes live connections; non-owner delete leaves project', async () => {
    const id = await create()
    await patchJson(`/api/projects/${id}`, { linkAccess: 'viewer' }, alice)
    await get(`/api/projects/${id}`, bob)
    expect((await del(`/api/projects/${id}`, bob)).status).toBe(200)
    expect(hub.closeAll).not.toHaveBeenCalled()
    expect((await getJson('/api/projects', bob)).length).toBe(0)
    expect((await get(`/api/projects/${id}`, alice)).status).toBe(200)
    expect((await del(`/api/projects/${id}`, alice)).status).toBe(200)
    expect(hub.closeAll).toHaveBeenCalledWith(id, 'deleted')
    expect((await get(`/api/projects/${id}`, alice)).status).toBe(404)
  })

  test('revoked projects disappear from the member list but stay for the owner', async () => {
    const id = await create()
    await patchJson(`/api/projects/${id}`, { linkAccess: 'viewer' }, alice)
    await get(`/api/projects/${id}`, bob)
    expect((await getJson('/api/projects?filter=shared', bob)).map((p: any) => p.id)).toEqual([id])
    await patchJson(`/api/projects/${id}`, { linkAccess: 'restricted' }, alice)
    for (const f of ['any', 'shared']) {
      expect((await getJson(`/api/projects?filter=${f}`, bob)).map((p: any) => p.id)).not.toContain(id)
    }
    expect((await getJson('/api/projects?filter=any', alice)).map((p: any) => p.id)).toContain(id)
  })

  test('copy uses snapshotFiles, titles Copy of, restricted', async () => {
    const id = await create()
    await patchJson(`/api/projects/${id}`, { linkAccess: 'viewer' }, alice)
    const r = await postJson(`/api/projects/${id}/copy`, {}, bob)
    expect(r.status).toBe(200)
    const { id: copyId } = await r.json() as any
    expect(hub.snapshotFiles).toHaveBeenCalledWith(id)
    const d = await getJson(`/api/projects/${copyId}`, bob)
    expect(d).toMatchObject({ title: 'Copy of TS library', role: 'owner', linkAccess: 'restricted' })
    expect((await postJson(`/api/projects/${id}/copy`, {}, guest)).status).toBe(401)
    await patchJson(`/api/projects/${id}`, { linkAccess: 'restricted' }, alice)
    const other = await mkUser('eve' + n)
    expect((await postJson(`/api/projects/${id}/copy`, {}, other)).status).toBe(403)
  })
})
