import { createHash } from 'node:crypto'
import { Hono, type Context } from 'hono'
import { deleteCookie, setCookie } from 'hono/cookie'
import { newToken } from '@webcode/shared'
import type { Deps } from '../app.js'
import { signGuest, signValue, verifyGuest, verifyValue } from '../../auth/guest.js'
import { GUEST_COOKIE, OAUTH_STATE_COOKIE, SESSION_COOKIE, identify, readCookies } from '../../auth/identify.js'
import { createSession, deleteSession } from '../../db/sessions.js'
import { upsertGithubUser } from '../../db/users.js'

const SESSION_MAX_AGE = 30 * 24 * 60 * 60
const GUEST_MAX_AGE = 365 * 24 * 60 * 60

/** Only same-origin relative paths: a single leading `/`, no `//`, no backslashes, no control chars. */
export function safeNext(raw: string | undefined | null): string | null {
  if (!raw || raw.length > 2000) return null
  if (!raw.startsWith('/') || raw.startsWith('//')) return null
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return null
  return raw
}

function cookieOpts(deps: Deps, maxAge: number) {
  const { origin } = new URL(deps.config.publicUrl)
  const local = origin === 'http://localhost' || origin === 'http://127.0.0.1' ||
    /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)
  return { httpOnly: true, secure: !local, sameSite: 'Lax' as const, path: '/', maxAge }
}

async function readBody(c: Context): Promise<Record<string, unknown>> {
  try {
    const b = await c.req.json()
    return b && typeof b === 'object' ? b as Record<string, unknown> : {}
  } catch { return {} }
}

export function authRoutes(deps: Deps): Hono {
  const { config, sql } = deps
  const app = new Hono()

  app.get('/auth/github', c => {
    const state = newToken(24)
    const next = safeNext(c.req.query('next'))
    setCookie(c, OAUTH_STATE_COOKIE, signValue({ state, next }, config.sessionSecret), cookieOpts(deps, 600))
    return c.redirect(deps.github.authorizeUrl(state), 302)
  })

  app.get('/auth/github/callback', async c => {
    const cookies = readCookies(c.req.header('cookie'))
    const st = cookies[OAUTH_STATE_COOKIE] ? verifyValue(cookies[OAUTH_STATE_COOKIE], config.sessionSecret) as { state?: string; next?: unknown } | null : null
    const state = c.req.query('state')
    const code = c.req.query('code')
    if (!st || typeof st.state !== 'string' || !state || st.state !== state || !code) {
      return c.json({ error: 'bad-state' }, 400)
    }
    const next = typeof st.next === 'string' ? safeNext(st.next) : null
    deleteCookie(c, OAUTH_STATE_COOKIE, { path: '/' })
    let user
    try {
      const token = await deps.github.exchangeCode(code)
      user = await upsertGithubUser(sql, await deps.github.getUser(token))
    } catch {
      return c.redirect('/?signin=failed', 302)
    }
    const session = await createSession(sql, user.id)
    setCookie(c, SESSION_COOKIE, session.id, cookieOpts(deps, SESSION_MAX_AGE))
    const raw = cookies[GUEST_COOKIE]
    const guest = raw ? verifyGuest(raw, config.sessionSecret) : null
    await deps.onSignedIn?.({ userId: user.id, guest, next })
    return c.redirect(next ?? '/', 302)
  })

  app.post('/auth/logout', async c => {
    const sid = readCookies(c.req.header('cookie'))[SESSION_COOKIE]
    if (sid) await deleteSession(sql, sid)
    deleteCookie(c, SESSION_COOKIE, { path: '/' })
    return c.body(null, 204)
  })

  app.post('/auth/test-login', async c => {
    if (!config.e2eTestLogin || config.isProd) return c.json({ error: 'not-found' }, 404)
    const login = (await readBody(c)).login
    if (typeof login !== 'string' || !/^[A-Za-z0-9_-]{1,39}$/.test(login)) return c.json({ error: 'bad-login' }, 400)
    const githubId = -(createHash('sha256').update(`webcode-test:${login}`).digest().readUIntBE(0, 6) + 1)
    const user = await upsertGithubUser(sql, { githubId, login, name: login, avatarUrl: '' })
    const session = await createSession(sql, user.id)
    setCookie(c, SESSION_COOKIE, session.id, cookieOpts(deps, SESSION_MAX_AGE))
    return c.body(null, 204)
  })

  app.post('/api/guest', async c => {
    const name = (await readBody(c)).name
    const trimmed = typeof name === 'string' ? name.trim() : ''
    if (trimmed.length < 1 || trimmed.length > 40) return c.json({ error: 'bad-name' }, 400)
    const existing = readCookies(c.req.header('cookie'))[GUEST_COOKIE]
    const prior = existing ? verifyGuest(existing, config.sessionSecret) : null
    const guest = { guestId: prior?.guestId ?? newToken(16), name: trimmed }
    setCookie(c, GUEST_COOKIE, signGuest(guest, config.sessionSecret), cookieOpts(deps, GUEST_MAX_AGE))
    return c.json({ guest })
  })

  app.get('/api/me', async c => {
    const { user, guest } = await identify(c, deps)
    return c.json({
      user: user ? { id: user.id, login: user.login, name: user.name, avatarUrl: `/api/avatar/${user.id}` } : null,
      guest,
    })
  })

  return app
}
