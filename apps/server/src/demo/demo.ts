import { LIMITS } from '@webcode/shared'
import type { Sql } from '../db/db.js'
import type { CollabHub } from '../collab/types.js'
import { deleteProject, getProject, touchMember, type Project } from '../db/projects.js'
import { createProjectFromFiles } from '../projects/create.js'
import { loadTemplate } from '../templates/index.js'

export const DEMO_BUSY = 'The demo is busy, try again in a few minutes'

/** The guest's current demo copy, if any. */
export async function findGuestCopy(sql: Sql, guestId: string): Promise<Project | null> {
  const [row] = await sql`
    select id from projects where owner_guest_id = ${guestId} and is_demo_copy
    order by created_at desc limit 1`
  return row ? getProject(sql, row.id) : null
}

/** Live demo copies: guest-owned and still flagged as demo. */
export async function countLiveDemos(sql: Sql): Promise<number> {
  const [row] = await sql`select count(*)::int as n from projects where is_demo_copy and owner_guest_id is not null`
  return row!.n
}

export async function createDemoCopy(deps: { sql: Sql; now?: () => Date }, guestId: string): Promise<Project> {
  const now = deps.now?.() ?? new Date()
  return createProjectFromFiles(deps, { guestId }, await loadTemplate('demo'), {
    title: 'Demo', template: 'demo', linkAccess: 'editor', isDemoCopy: true,
    expiresAt: new Date(now.getTime() + LIMITS.demoIdleMs),
  })
}

/** Turns a guest's demo copy (any still existing; cleanup removes idle ones) into a normal project owned by the user. */
export async function claimProject(
  sql: Sql, projectId: string, guestId: string, userId: string,
): Promise<boolean> {
  return sql.begin(async tx => {
    const rows = await tx`
      update projects
      set owner_id = ${userId}, owner_guest_id = null, is_demo_copy = false, expires_at = null, updated_at = now()
      where id = ${projectId} and owner_guest_id = ${guestId}
      returning id`
    if (rows.length === 0) return false
    await touchMember(tx as unknown as Sql, projectId, userId)
    return true
  })
}

/** Deletes demo copies idle for 24 h that nobody is connected to. Returns how many were deleted. */
export async function cleanupExpiredDemos(deps: { sql: Sql; collab: CollabHub }, now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - LIMITS.demoIdleMs)
  const rows = await deps.sql`
    select id from projects where is_demo_copy and owner_guest_id is not null and last_active_at < ${cutoff}`
  let n = 0
  for (const { id } of rows) {
    if (deps.collab.liveCount(id) > 0) continue
    await deleteProject(deps.sql, id)
    n++
  }
  return n
}

/** Claim hook for the OAuth callback; never throws, so sign-in always completes. */
export function claimOnSignIn(deps: { sql: Sql; now?: () => Date }) {
  return async (e: { userId: string; guest: { guestId: string } | null; next: string | null }): Promise<void> => {
    try {
      const m = e.guest && e.next ? /^\/p\/([A-Za-z0-9_-]+)\/?(?:[?#].*)?$/.exec(e.next) : null
      if (!e.guest || !m) return
      await claimProject(deps.sql, m[1]!, e.guest.guestId, e.userId)
    } catch (err) {
      console.error('[demo] claim on sign-in failed:', err instanceof Error ? err.message : 'unknown error')
    }
  }
}
