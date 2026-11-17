import type { Sql } from 'postgres'
import { newToken } from '@webcode/shared'
import { toUser, type User } from './users'

export async function createSession(sql: Sql, userId: string): Promise<{ id: string; expiresAt: Date }> {
  const id = newToken(32)
  const [row] = await sql`
    insert into sessions (id, user_id, expires_at)
    values (${id}, ${userId}, now() + interval '30 days')
    returning expires_at`
  return { id, expiresAt: row!.expires_at }
}

/** Returns the session's user, or null if unknown/expired. Renews to 30 days when < 29 days remain. */
export async function getSessionUser(sql: Sql, id: string): Promise<User | null> {
  const [row] = await sql`
    with s as (
      update sessions set expires_at = now() + interval '30 days'
      where id = ${id} and expires_at > now() and expires_at < now() + interval '29 days'
      returning user_id
    ), cur as (
      select user_id from sessions where id = ${id} and expires_at > now()
    )
    select u.* from users u
    where u.id = coalesce((select user_id from s), (select user_id from cur))`
  return row ? toUser(row) : null
}

export async function deleteSession(sql: Sql, id: string): Promise<void> {
  await sql`delete from sessions where id = ${id}`
}
