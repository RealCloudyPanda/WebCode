import type { Context } from 'hono'
import { setCookie } from 'hono/cookie'
import type { Viewer } from '@webcode/shared'
import type { Config } from '../config.js'
import type { Sql } from '../db/db.js'
import { getSessionUser } from '../db/sessions.js'
import type { User } from '../db/users.js'
import { verifyGuest, type Guest } from './guest.js'

export const SESSION_COOKIE = 'wc_session'
export const GUEST_COOKIE = 'wc_guest'
export const OAUTH_STATE_COOKIE = 'wc_oauth_state'

export const SESSION_MAX_AGE = 30 * 24 * 60 * 60

export function cookieOpts(config: Config, maxAge: number) {
  const { origin } = new URL(config.publicUrl)
  const local = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
  return { httpOnly: true, secure: !local, sameSite: 'Lax' as const, path: '/', maxAge }
}

export type Identity = { viewer: Viewer; user: User | null; guest: Guest | null }

export function readCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    const k = part.slice(0, i).trim()
    if (!k || k in out) continue
    let v = part.slice(i + 1).trim()
    if (v.startsWith('"') && v.endsWith('"') && v.length >= 2) v = v.slice(1, -1)
    try { v = decodeURIComponent(v) } catch { /* keep raw */ }
    out[k] = v
  }
  return out
}

export async function identifyFromCookies(
  cookies: Record<string, string>, deps: { sql: Sql; config: Config },
): Promise<Identity> {
  const sid = cookies[SESSION_COOKIE]
  if (sid) {
    const user = await getSessionUser(deps.sql, sid)
    if (user) return { viewer: { kind: 'user', userId: user.id }, user, guest: null }
  }
  const raw = cookies[GUEST_COOKIE]
  const guest = raw ? verifyGuest(raw, deps.config.sessionSecret) : null
  if (guest) return { viewer: { kind: 'guest', guestId: guest.guestId }, user: null, guest }
  return { viewer: { kind: 'anonymous' }, user: null, guest: null }
}

/** Resolves the viewer; a valid session also gets its cookie's 30-day Max-Age renewed (once per request). */
export async function identify(c: Context, deps: { sql: Sql; config: Config }): Promise<Identity> {
  const cookies = readCookies(c.req.header('cookie'))
  const id = await identifyFromCookies(cookies, deps)
  if (id.user && cookies[SESSION_COOKIE]) {
    setCookie(c, SESSION_COOKIE, cookies[SESSION_COOKIE], cookieOpts(deps.config, SESSION_MAX_AGE))
  }
  return id
}

/** For the WebSocket upgrade: resolves the viewer from a raw `Cookie` header. Never sets cookies. */
export async function viewerFromCookieHeader(
  header: string | undefined, deps: { sql: Sql; config: Config },
): Promise<{ viewer: Viewer; displayName: string; userId?: string }> {
  const { viewer, user, guest } = await identifyFromCookies(readCookies(header), deps)
  if (user) return { viewer, displayName: user.name || user.login, userId: user.id }
  return { viewer, displayName: guest?.name ?? '' }
}
