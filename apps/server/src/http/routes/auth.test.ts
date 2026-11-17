import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { Sql } from 'postgres'
import type { Hono } from 'hono'
import { dbSkipReason, setupTestDb, TEST_DB_URL } from '../../../test/db-helpers'
import { loadConfig } from '../../config.js'
import { createApp, type Deps } from '../app.js'
import { RateLimiter } from '../../util/rate-limit.js'
import { createNoopCollab } from '../../collab/types.js'
import type { GithubClient } from '../../auth/github.js'
import { signGuest } from '../../auth/guest.js'
import { readCookies } from '../../auth/identify.js'
import { isolationHeaders } from '../security.js'
import { Hono as HonoApp } from 'hono'

const ORIGIN = 'http://localhost:5173'
const SECRET = 'test-secret'

test('isolation middleware survives handlers returning immutable responses', async () => {
  const a = new HonoApp()
  a.use('*', isolationHeaders())
  a.get('/r', () => Response.redirect('http://localhost/x', 302))
  const r = await a.request('/r')
  expect(r.status).toBe(302)
  expect(r.headers.get('cross-origin-opener-policy')).toBe('same-origin')
})

test('readCookies parses header', () => {
  expect(readCookies('a=1; b=two%20x;c=')).toEqual({ a: '1', b: 'two x', c: '' })
  expect(readCookies(undefined)).toEqual({})
})

describe.skipIf(!TEST_DB_URL)(`auth routes (${TEST_DB_URL ? 'postgres' : dbSkipReason})`, () => {
  let sql: Sql
  let teardown: () => Promise<void>
  let signedIn: any[] = []
  let avatarFetches = 0
  let ghFail = false
  const github: GithubClient = {
    authorizeUrl: s => `https://github.com/login/oauth/authorize?state=${s}`,
    exchangeCode: async code => { if (ghFail) throw new Error('boom'); return `tok-${code}` },
    getUser: async t => ({ githubId: 42, login: t.replace('tok-', ''), name: 'Octo Cat', avatarUrl: 'https://avatars.githubusercontent.com/u/42' }),
    downloadTarball: async () => new Uint8Array(),
    fetchAvatar: async () => { avatarFetches++; return { body: new Uint8Array([1, 2, 3]), contentType: 'image/png' } },
  }
  const mk = (over: Record<string, string | undefined> = {}, extra: Partial<Deps> = {}): Hono =>
    createApp({
      sql, config: loadConfig({ PUBLIC_URL: ORIGIN, SESSION_SECRET: SECRET, ...over }), github,
      collab: createNoopCollab(), limiter: new RateLimiter(),
      onSignedIn: async e => { signedIn.push(e) }, ...extra,
    })
  let app: Hono
  beforeAll(async () => { ({ sql, teardown } = await setupTestDb()); app = mk() })
  afterAll(async () => { await teardown?.() })

  const jar = (r: Response): Record<string, string> => {
    const out: Record<string, string> = {}
    for (const sc of r.headers.getSetCookie()) {
      const [kv] = sc.split(';'); const i = kv!.indexOf('=')
      out[kv!.slice(0, i)] = decodeURIComponent(kv!.slice(i + 1))
    }
    return out
  }
  const ck = (o: Record<string, string>) => Object.entries(o).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('; ')
  const get = (a: Hono, path: string, cookies: Record<string, string> = {}) =>
    a.request(path, { headers: { cookie: ck(cookies) } })
  const post = (a: Hono, path: string, body: unknown, cookies: Record<string, string> = {}) =>
    a.request(path, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json', cookie: ck(cookies) }, body: JSON.stringify(body) })

  async function signIn(a: Hono, login: string, next?: string, extraCookies: Record<string, string> = {}) {
    const start = await get(a, '/auth/github' + (next ? `?next=${encodeURIComponent(next)}` : ''))
    const sc = jar(start)
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!
    const res = await get(a, `/auth/github/callback?code=${login}&state=${state}`, { wc_oauth_state: sc.wc_oauth_state!, ...extraCookies })
    return { res, cookies: jar(res) }
  }

  test('GET /auth/github sets state cookie and redirects to GitHub', async () => {
    const r = await get(app, '/auth/github')
    expect(r.status).toBe(302)
    expect(r.headers.get('location')).toMatch(/^https:\/\/github\.com\/login\/oauth\/authorize\?state=/)
    const raw = r.headers.getSetCookie().find(s => s.startsWith('wc_oauth_state='))!
    expect(raw).toMatch(/HttpOnly/i); expect(raw).toMatch(/SameSite=Lax/i); expect(raw).toMatch(/Max-Age=600/i)
    expect(raw).not.toMatch(/Secure/i) // localhost
  })

  test('cookies are Secure on https publicUrl', async () => {
    const a = mk({ PUBLIC_URL: 'https://webcode.example' })
    const raw = (await get(a, '/auth/github')).headers.getSetCookie()[0]!
    expect(raw).toMatch(/Secure/)
  })

  test('callback with wrong state is 400', async () => {
    expect((await get(app, '/auth/github/callback?code=c&state=x', { wc_oauth_state: 'y' })).status).toBe(400)
    expect((await get(app, '/auth/github/callback?code=c&state=x')).status).toBe(400)
  })

  test('callback creates user + session, /api/me returns user', async () => {
    const { res, cookies } = await signIn(app, 'octo')
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/')
    const raw = res.headers.getSetCookie().find(s => s.startsWith('wc_session='))!
    expect(raw).toMatch(/HttpOnly/i); expect(raw).toMatch(/Max-Age=2592000/); expect(raw).toMatch(/SameSite=Lax/i)
    const me = await (await get(app, '/api/me', { wc_session: cookies.wc_session! })).json() as any
    expect(me.user.login).toBe('octo')
    expect(me.user.avatarUrl).toBe(`/api/avatar/${me.user.id}`)
    expect(me.guest).toBeNull()
    expect(signedIn.at(-1)).toMatchObject({ userId: me.user.id, guest: null, next: null })
  })

  test('next is honored only for same-origin relative paths', async () => {
    expect((await signIn(app, 'octo', '/p/abc?x=1')).res.headers.get('location')).toBe('/p/abc?x=1')
    for (const bad of ['//evil.com', '/\\evil', 'https://evil.com', 'javascript:1', 'p/abc']) {
      const { res } = await signIn(app, 'octo', bad)
      expect(res.headers.get('location'), bad).toBe('/')
    }
  })

  test('state cookie cannot be forged to carry a next', async () => {
    const start = await get(app, '/auth/github')
    const state = new URL(start.headers.get('location')!).searchParams.get('state')!
    const forged = Buffer.from(JSON.stringify({ state, next: '//evil.com' })).toString('base64url') + '.AAAA'
    expect((await get(app, `/auth/github/callback?code=c&state=${state}`, { wc_oauth_state: forged })).status).toBe(400)
  })

  test('github failure redirects to /?signin=failed', async () => {
    ghFail = true
    try {
      const { res } = await signIn(app, 'octo')
      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toBe('/?signin=failed')
      expect(jar(res).wc_session).toBeUndefined()
    } finally { ghFail = false }
  })

  test('callback passes verified guest and next to onSignedIn', async () => {
    const g = { guestId: 'gid1', name: 'Jess' }
    await signIn(app, 'octo', '/p/z', { wc_guest: signGuest(g, SECRET) })
    expect(signedIn.at(-1)).toMatchObject({ guest: g, next: '/p/z' })
    await signIn(app, 'octo', undefined, { wc_guest: signGuest(g, 'other') })
    expect(signedIn.at(-1).guest).toBeNull()
  })

  test('logout deletes session and clears cookie', async () => {
    const { cookies } = await signIn(app, 'octo')
    const r = await post(app, '/auth/logout', undefined, { wc_session: cookies.wc_session! })
    expect(r.status).toBe(204)
    expect(r.headers.getSetCookie().find(s => s.startsWith('wc_session='))).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/i)
    const me = await (await get(app, '/api/me', { wc_session: cookies.wc_session! })).json() as any
    expect(me.user).toBeNull()
  })

  test('guest name validation, cookie, id reuse, /api/me', async () => {
    expect((await post(app, '/api/guest', { name: '   ' })).status).toBe(400)
    expect((await post(app, '/api/guest', { name: 'x'.repeat(41) })).status).toBe(400)
    expect((await post(app, '/api/guest', {})).status).toBe(400)
    const r = await post(app, '/api/guest', { name: '  Jess  ' })
    expect(r.status).toBe(200)
    const c = jar(r)
    const raw = r.headers.getSetCookie().find(s => s.startsWith('wc_guest='))!
    expect(raw).toMatch(/HttpOnly/i)
    const me = await (await get(app, '/api/me', { wc_guest: c.wc_guest! })).json() as any
    expect(me.guest.name).toBe('Jess'); expect(me.user).toBeNull()
    const r2 = await post(app, '/api/guest', { name: 'Jessica' }, { wc_guest: c.wc_guest! })
    const me2 = await (await get(app, '/api/me', { wc_guest: jar(r2).wc_guest! })).json() as any
    expect(me2.guest.guestId).toBe(me.guest.guestId); expect(me2.guest.name).toBe('Jessica')
  })

  test('session wins over guest; invalid session ignored', async () => {
    const { cookies } = await signIn(app, 'octo')
    const guest = signGuest({ guestId: 'g9', name: 'G' }, SECRET)
    const both = await (await get(app, '/api/me', { wc_session: cookies.wc_session!, wc_guest: guest })).json() as any
    expect(both.user.login).toBe('octo')
    const bad = await (await get(app, '/api/me', { wc_session: 'nope', wc_guest: guest })).json() as any
    expect(bad.user).toBeNull(); expect(bad.guest.guestId).toBe('g9')
  })

  test('test-login: 404 in production or when disabled; works otherwise', async () => {
    expect((await post(mk({ E2E_TEST_LOGIN: '1', NODE_ENV: 'production', DATABASE_URL: 'x', GITHUB_CLIENT_ID: 'x', GITHUB_CLIENT_SECRET: 'x', SESSION_SECRET: 'x', PUBLIC_URL: ORIGIN }), '/auth/test-login', { login: 'bob' })).status).toBe(404)
    expect((await post(app, '/auth/test-login', { login: 'bob' })).status).toBe(404)
    const a = mk({ E2E_TEST_LOGIN: '1' })
    expect((await post(a, '/auth/test-login', {})).status).toBe(400)
    const r = await post(a, '/auth/test-login', { login: 'bob' })
    expect(r.status).toBe(204)
    const c = jar(r)
    const me = await (await get(a, '/api/me', { wc_session: c.wc_session! })).json() as any
    expect(me.user.login).toBe('bob')
    const r2 = await post(a, '/auth/test-login', { login: 'bob' })
    const me2 = await (await get(a, '/api/me', { wc_session: jar(r2).wc_session! })).json() as any
    expect(me2.user.id).toBe(me.user.id)
  })

  test('avatar proxy: 404 for empty/unknown, caches, headers', async () => {
    const a = mk({ E2E_TEST_LOGIN: '1' })
    const noAv = jar(await post(a, '/auth/test-login', { login: 'noav' }))
    const noAvId = ((await (await get(a, '/api/me', { wc_session: noAv.wc_session! })).json()) as any).user.id
    expect((await get(a, `/api/avatar/${noAvId}`)).status).toBe(404)
    expect((await get(a, '/api/avatar/unknown')).status).toBe(404)

    const { cookies } = await signIn(a, 'avatarguy')
    const id = ((await (await get(a, '/api/me', { wc_session: cookies.wc_session! })).json()) as any).user.id
    const before = avatarFetches
    const r = await get(a, `/api/avatar/${id}`)
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toBe('image/png')
    expect(r.headers.get('cache-control')).toBe('public, max-age=86400')
    expect(r.headers.get('cross-origin-resource-policy')).toBe('same-origin')
    expect([...new Uint8Array(await r.arrayBuffer())]).toEqual([1, 2, 3])
    await get(a, `/api/avatar/${id}`)
    expect(avatarFetches - before).toBe(1)
  })
})
