import type { Context } from 'hono'
import type { Viewer } from '@webcode/shared'
import type { Config } from '../config.js'
import type { Sql } from '../db/db.js'
import { getSessionUser } from '../db/sessions.js'
import type { User } from '../db/users.js'
import { verifyGuest, type Guest } from './guest.js'

export const SESSION_COOKIE = 'wc_session'
export const GUEST_COOKIE = 'wc_guest'
export const OAUTH_STATE_COOKIE = 'wc_oauth_state'

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

export function identify(c: Context, deps: { sql: Sql; config: Config }): Promise<Identity> {
  return identifyFromCookies(readCookies(c.req.header('cookie')), deps)
}
