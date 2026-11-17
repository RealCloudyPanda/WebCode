import type { Sql } from 'postgres'
import { newProjectId, type LinkAccess } from '@webcode/shared'

export type NewProject = {
  ownerId?: string | null
  ownerGuestId?: string | null
  title: string
  template: string
  linkAccess: LinkAccess
  isDemoCopy?: boolean
  expiresAt?: Date | null
}

export type Project = {
  id: string
  ownerId: string | null
  ownerGuestId: string | null
  title: string
  linkAccess: LinkAccess
  template: string
  isDemoCopy: boolean
  expiresAt: Date | null
  lastActiveAt: Date
  previewText: string
  createdAt: Date
  updatedAt: Date
}

export type ProjectRow = Project & {
  starred: boolean
  lastOpenedAt: Date
  ownerLogin: string | null
  isOwner: boolean
}

export type Member = { userId: string; login: string; name: string | null; avatarUrl: string; lastOpenedAt: Date; starred: boolean; isOwner: boolean }

function toProject(r: any): Project {
  return {
    id: r.id, ownerId: r.owner_id, ownerGuestId: r.owner_guest_id, title: r.title,
    linkAccess: r.link_access, template: r.template, isDemoCopy: r.is_demo_copy,
    expiresAt: r.expires_at, lastActiveAt: r.last_active_at, previewText: r.preview_text,
    createdAt: r.created_at, updatedAt: r.updated_at,
  }
}

export async function insertProject(sql: Sql, p: NewProject): Promise<Project> {
  const [row] = await sql`
    insert into projects (id, owner_id, owner_guest_id, title, link_access, template, is_demo_copy, expires_at)
    values (${newProjectId()}, ${p.ownerId ?? null}, ${p.ownerGuestId ?? null}, ${p.title},
            ${p.linkAccess}, ${p.template}, ${p.isDemoCopy ?? false}, ${p.expiresAt ?? null})
    returning *`
  return toProject(row)
}

export async function getProject(sql: Sql, id: string): Promise<Project | null> {
  const [row] = await sql`select * from projects where id = ${id}`
  return row ? toProject(row) : null
}

/** Projects the user has a membership row for. Starred first, then by recency or title. */
export async function listForUser(
  sql: Sql, userId: string, filter: 'any' | 'mine' | 'shared', sort: 'opened' | 'title',
): Promise<ProjectRow[]> {
  const rows = await sql`
    select p.*, m.starred, m.last_opened_at, o.login as owner_login, (p.owner_id is not distinct from ${userId}) as is_owner
    from project_members m
    join projects p on p.id = m.project_id
    left join users o on o.id = p.owner_id
    where m.user_id = ${userId}
      and (${filter} = 'any'
           or (${filter} = 'mine' and p.owner_id = ${userId})
           or (${filter} = 'shared' and p.owner_id is distinct from ${userId}))
    order by m.starred desc,
      ${sort === 'title' ? sql`lower(p.title) asc, p.id asc` : sql`m.last_opened_at desc, p.id asc`}`
  return rows.map(r => ({
    ...toProject(r), starred: r.starred, lastOpenedAt: r.last_opened_at,
    ownerLogin: r.owner_login ?? null, isOwner: r.is_owner,
  }))
}

export async function touchMember(sql: Sql, projectId: string, userId: string): Promise<void> {
  await sql`
    insert into project_members (project_id, user_id) values (${projectId}, ${userId})
    on conflict (project_id, user_id) do update set last_opened_at = now()`
}

export async function setStarred(sql: Sql, projectId: string, userId: string, starred: boolean): Promise<void> {
  await sql`update project_members set starred = ${starred} where project_id = ${projectId} and user_id = ${userId}`
}

export async function setLinkAccess(sql: Sql, projectId: string, linkAccess: LinkAccess): Promise<void> {
  await sql`update projects set link_access = ${linkAccess}, updated_at = now() where id = ${projectId}`
}

export async function setTitle(sql: Sql, projectId: string, title: string): Promise<void> {
  await sql`update projects set title = ${title}, updated_at = now() where id = ${projectId}`
}

export async function removeMember(sql: Sql, projectId: string, userId: string): Promise<void> {
  await sql`delete from project_members where project_id = ${projectId} and user_id = ${userId}`
}

export async function deleteProject(sql: Sql, projectId: string): Promise<void> {
  await sql`delete from projects where id = ${projectId}`
}

/** Projects owned by the user, excluding demo copies. */
export async function countOwned(sql: Sql, userId: string): Promise<number> {
  const [row] = await sql`select count(*)::int as n from projects where owner_id = ${userId} and not is_demo_copy`
  return row!.n
}

export async function listMembers(sql: Sql, projectId: string): Promise<Member[]> {
  const rows = await sql`
    select m.user_id, u.login, u.name, u.avatar_url, m.last_opened_at, m.starred,
           (p.owner_id is not distinct from m.user_id) as is_owner
    from project_members m
    join users u on u.id = m.user_id
    join projects p on p.id = m.project_id
    where m.project_id = ${projectId}
    order by is_owner desc, m.last_opened_at desc`
  return rows.map(r => ({
    userId: r.user_id, login: r.login, name: r.name, avatarUrl: r.avatar_url,
    lastOpenedAt: r.last_opened_at, starred: r.starred, isOwner: r.is_owner,
  }))
}

export async function touchActive(sql: Sql, projectId: string): Promise<void> {
  await sql`update projects set last_active_at = now() where id = ${projectId}`
}
