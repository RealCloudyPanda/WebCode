import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'
import type { Sql } from 'postgres'
import type { Hono } from 'hono'
import { LIMITS } from '@webcode/shared'
import { dbSkipReason, setupTestDb, TEST_DB_URL } from '../../test/db-helpers'
import { loadConfig } from '../config.js'
import { createApp, type Deps } from '../http/app.js'
import { RateLimiter } from '../util/rate-limit.js'
import { createNoopCollab } from '../collab/types.js'
import type { GithubClient } from '../auth/github.js'
import { signGuest } from '../auth/guest.js'
import { upsertGithubUser } from '../db/users.js'
import { getProject, listForUser } from '../db/projects.js'
import { loadDoc } from '../db/docs.js'
import { claimProject, cleanupExpiredDemos } from './demo.js'

const ORIGIN = 'http://localhost:5173'
const SECRET = 'test-secret'
const BUSY = 'The demo is busy, try again in a few minutes'

describe.skipIf(!TEST_DB_URL)(`demo (${TEST_DB_URL ? 'postgres' : dbSkipReason})`, () => {
  let sql: Sql
  let teardown: () => Promise<void>
  let app: Hono
  let deps: Deps
  let hub: any
  const github = {} as GithubClient

  const guestOf = (id: string) => ({ id, cookie: `wc_guest=${encodeURIComponent(signGuest({ guestId: id, name: 'Guest' }, SECRET))}` })
  const build = (onSignedIn?: Deps['onSignedIn']) => {
    hub = { ...createNoopCollab(), liveCount: vi.fn(() => 0), closeAll: vi.fn() }
    deps = {
      sql, config: loadConfig({ PUBLIC_URL: ORIGIN, SESSION_SECRET: SECRET }), github,
      collab: hub, limiter: new RateLimiter(), onSignedIn,
    }
    app = createApp(deps)
  }
  const post = (path: string, cookie: string, ip = '1.1.1.1') =>
    app.request(path, {
      method: 'POST',
      headers: { origin: ORIGIN, cookie, 'content-type': 'application/json', 'fly-client-ip': ip },
      body: '{}',
    })
  const demo = async (g: { cookie: string }, ip?: string) => (await post('/api/demo', g.cookie, ip)).json() as Promise<any>

  beforeAll(async () => { ({ sql, teardown } = await setupTestDb()) })
  afterAll(async () => { await teardown?.() })
  beforeEach(async () => { await sql`delete from projects`; build() })

  test('POST /api/demo requires a guest cookie', async () => {
    const r = await post('/api/demo', '')
    expect(r.status).toBe(401)
    expect(await r.json()).toEqual({ error: 'need-guest' })
  })

  test('creates a guest-owned demo copy with a stored doc', async () => {
    const r = await post('/api/demo', guestOf('g1').cookie)
    expect(r.status).toBe(200)
    const { id } = (await r.json()) as any
    const p = (await getProject(sql, id))!
    expect(p).toMatchObject({ ownerGuestId: 'g1', ownerId: null, isDemoCopy: true, linkAccess: 'editor', title: 'Demo', template: 'demo' })
    const ms = p.expiresAt!.getTime() - Date.now()
    expect(Math.abs(ms - LIMITS.demoIdleMs)).toBeLessThan(60_000)
    expect(await loadDoc(sql, id)).not.toBeNull()
  })

  test('same guest gets the same copy and consumes no limit', async () => {
    const g = guestOf('g1')
    const a = await demo(g)
    for (let i = 0; i < 10; i++) expect((await demo(g)).id).toBe(a.id)
    for (let i = 2; i <= 5; i++) expect((await post('/api/demo', guestOf('g' + i).cookie)).status).toBe(200)
  })

  test('6th copy from one IP in an hour is 429', async () => {
    for (let i = 1; i <= 5; i++) expect((await post('/api/demo', guestOf('g' + i).cookie)).status).toBe(200)
    const r = await post('/api/demo', guestOf('g6').cookie)
    expect(r.status).toBe(429)
    expect(await r.json()).toEqual({ error: 'rate-limited', message: BUSY })
    expect((await post('/api/demo', guestOf('g7').cookie, '2.2.2.2')).status).toBe(200)
  })

  test('x-forwarded-for is not trusted', async () => {
    for (let i = 1; i <= 5; i++) {
      await app.request('/api/demo', { method: 'POST', headers: { origin: ORIGIN, cookie: guestOf('x' + i).cookie, 'content-type': 'application/json', 'x-forwarded-for': `9.9.9.${i}` }, body: '{}' })
    }
    const r = await app.request('/api/demo', { method: 'POST', headers: { origin: ORIGIN, cookie: guestOf('x6').cookie, 'content-type': 'application/json', 'x-forwarded-for': '9.9.9.99' }, body: '{}' })
    expect(r.status).toBe(429)
  })

  test('site-wide live cap is 503', async () => {
    await sql`insert into projects (id, owner_guest_id, title, link_access, template, is_demo_copy)
              select 'fill' || i, 'f' || i, 'Demo', 'editor', 'demo', true from generate_series(1, ${LIMITS.maxLiveDemos}) i`
    const r = await post('/api/demo', guestOf('late').cookie)
    expect(r.status).toBe(503)
    expect(await r.json()).toEqual({ error: 'busy', message: BUSY })
    // an existing owner still gets their copy back even when full
    expect((await post('/api/demo', guestOf('f1').cookie)).status).toBe(200)
  })

  test('start-over replaces the copy, closes the old one, and counts toward the IP limit', async () => {
    const g = guestOf('g1')
    expect((await post('/api/demo/start-over', g.cookie)).status).toBe(404)
    const a = await demo(g)
    const r = await post('/api/demo/start-over', g.cookie)
    expect(r.status).toBe(200)
    const b = (await r.json()) as any
    expect(b.id).not.toBe(a.id)
    expect(hub.closeAll).toHaveBeenCalledWith(a.id, 'deleted')
    expect(await getProject(sql, a.id)).toBeNull()
    expect(await getProject(sql, b.id)).not.toBeNull()
    expect((await demo(g)).id).toBe(b.id)
    for (let i = 0; i < 3; i++) await post('/api/demo/start-over', g.cookie) // 1 + 1 + 3 = 5 hits
    expect((await post('/api/demo/start-over', g.cookie)).status).toBe(429)
  })

  const mkCopy = async (guestId: string) => ((await demo(guestOf(guestId), `10.0.0.${guestId.length}${Math.random()}`)).id as string)
  const mkUser = (n: number) => upsertGithubUser(sql, { githubId: 9000 + n, login: 'alice' + n, name: 'A', avatarUrl: 'x' })

  test('claim transfers ownership and clears expiry', async () => {
    const id = await mkCopy('g1')
    const alice = await mkUser(1)
    expect(await claimProject(sql, id, 'g1', alice.id)).toBe(true)
    const p = (await getProject(sql, id))!
    expect([p.ownerId, p.ownerGuestId, p.expiresAt, p.isDemoCopy]).toEqual([alice.id, null, null, false])
    expect((await listForUser(sql, alice.id, 'mine', 'opened')).map(r => r.id)).toContain(id)
  })

  test('claim by another guest fails; second claim fails; old but active copy can be claimed', async () => {
    const id = await mkCopy('g1')
    const alice = await mkUser(2)
    expect(await claimProject(sql, id, 'g2', alice.id)).toBe(false)
    await sql`update projects set created_at = now() - interval '30 hours', expires_at = now() - interval '6 hours' where id = ${id}`
    expect(await claimProject(sql, id, 'g1', alice.id)).toBe(true)
    expect(await claimProject(sql, id, 'g1', alice.id)).toBe(false)
  })

  test('cleanup deletes idle >24h, keeps active and claimed', async () => {
    const idle = await mkCopy('g1')
    const active = await mkCopy('g2')
    const claimed = await mkCopy('g3')
    const alice = await mkUser(3)
    await claimProject(sql, claimed, 'g3', alice.id)
    await sql`update projects set last_active_at = now() - interval '30 hours' where id in (${idle}, ${claimed})`
    expect(await cleanupExpiredDemos(deps, new Date())).toBe(1)
    expect(await getProject(sql, idle)).toBeNull()
    expect(await getProject(sql, active)).not.toBeNull()
    expect(await getProject(sql, claimed)).not.toBeNull()
    expect(await cleanupExpiredDemos(deps, new Date(Date.now() + 25 * 3600_000))).toBe(1)
    expect(await getProject(sql, active)).toBeNull()
  })

  test('cleanup skips copies with live connections', async () => {
    const id = await mkCopy('g1')
    hub.liveCount.mockImplementation((p: string) => (p === id ? 1 : 0))
    expect(await cleanupExpiredDemos(deps, new Date(Date.now() + 25 * 3600_000))).toBe(0)
    expect(await getProject(sql, id)).not.toBeNull()
  })

  describe('claim on sign-in', () => {
    const callback = async (guestCookie: string, next: string | null) => {
      const { signValue } = await import('../auth/guest.js')
      const user = await upsertGithubUser(sql, { githubId: 7777, login: 'cb', name: 'CB', avatarUrl: 'x' })
      const gh = { exchangeCode: async () => 't', getUser: async () => ({ githubId: 7777, login: 'cb', name: 'CB', avatarUrl: 'x' }) } as unknown as GithubClient
      deps = { ...deps, github: gh }
      app = createApp(deps)
      const state = signValue({ state: 's', next }, SECRET)
      const r = await app.request('/auth/github/callback?state=s&code=c', {
        headers: { origin: ORIGIN, cookie: `wc_oauth_state=${encodeURIComponent(state)}; ${guestCookie}` },
      })
      return { r, user }
    }

    test('claims the guest copy when next is /p/<id>', async () => {
      const g = guestOf('g1')
      const id = (await demo(g)).id
      const { r, user } = await callback(g.cookie, `/p/${id}`)
      expect(r.status).toBe(302)
      expect((await getProject(sql, id))!.ownerId).toBe(user.id)
    })

    test('does not claim when next points elsewhere', async () => {
      const g = guestOf('g1')
      const id = (await demo(g)).id
      const { r } = await callback(g.cookie, '/')
      expect(r.status).toBe(302)
      expect((await getProject(sql, id))!.ownerGuestId).toBe('g1')
    })

    test("a different guest's cookie cannot claim the copy", async () => {
      const id = (await demo(guestOf('g1'))).id
      const { r } = await callback(guestOf('g2').cookie, `/p/${id}`)
      expect(r.status).toBe(302)
      expect((await getProject(sql, id))!.ownerGuestId).toBe('g1')
    })

    test('a failing claim never breaks sign-in', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const bad = guestOf('bad\u0000id') // Postgres rejects NUL in text, so the claim query throws
      const { r } = await callback(bad.cookie, '/p/someid')
      expect(r.status).toBe(302)
      expect(spy).toHaveBeenCalled()
      spy.mockRestore()
    })
  })
})
