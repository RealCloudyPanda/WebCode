import type { Sql } from 'postgres'
import { newToken } from '@webcode/shared'

export type User = {
  id: string
  githubId: number
  login: string
  name: string | null
  avatarUrl: string
  createdAt: Date
}

export function toUser(r: any): User {
  return {
    id: r.id, githubId: Number(r.github_id), login: r.login, name: r.name,
    avatarUrl: r.avatar_url, createdAt: r.created_at,
  }
}

export async function upsertGithubUser(
  sql: Sql,
  gh: { githubId: number; login: string; name: string | null; avatarUrl: string },
): Promise<User> {
  const [row] = await sql`
    insert into users (id, github_id, login, name, avatar_url)
    values (${newToken(16)}, ${gh.githubId}, ${gh.login}, ${gh.name}, ${gh.avatarUrl})
    on conflict (github_id) do update
      set login = excluded.login, name = excluded.name, avatar_url = excluded.avatar_url
    returning *`
  return toUser(row)
}

export async function getUser(sql: Sql, id: string): Promise<User | null> {
  const [row] = await sql`select * from users where id = ${id}`
  return row ? toUser(row) : null
}
