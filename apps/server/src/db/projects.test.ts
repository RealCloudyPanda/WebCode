import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { Sql } from 'postgres'
import { dbSkipReason, setupTestDb, TEST_DB_URL } from '../../test/db-helpers'
import { migrate } from './migrate'
import { upsertGithubUser } from './users'
import {
  countOwned, deleteProject, getProject, insertProject, listForUser, listMembers,
  removeMember, setLinkAccess, setStarred, setTitle, touchActive, touchMember,
} from './projects'
import { loadDoc, storeDoc, totalStoredBytes } from './docs'

describe.skipIf(!TEST_DB_URL)(`projects repo (${TEST_DB_URL ? 'postgres' : dbSkipReason})`, () => {
  let sql: Sql
  let teardown: () => Promise<void>
  beforeAll(async () => { ({ sql, teardown } = await setupTestDb()) })
  afterAll(async () => { await teardown?.() })

  const mkUser = (n: number, login = `u${n}`) =>
    upsertGithubUser(sql, { githubId: 1000 + n, login, name: null, avatarUrl: 'x' })
  const mk = (ownerId: string, title: string, linkAccess: 'restricted' | 'viewer' | 'editor' = 'restricted') =>
    insertProject(sql, { ownerId, title, template: 'blank', linkAccess })

  test('migrate is idempotent', async () => {
    await migrate(sql)
    await Promise.all([migrate(sql), migrate(sql)])
    const rows = await sql`select count(*)::int as n from schema_migrations`
    expect(rows[0]!.n).toBe(1)
  })

  test('upsertGithubUser updates existing', async () => {
    const a = await upsertGithubUser(sql, { githubId: 7, login: 'old', name: null, avatarUrl: 'x' })
    const b = await upsertGithubUser(sql, { githubId: 7, login: 'new', name: 'N', avatarUrl: 'y' })
    expect(b.id).toBe(a.id)
    expect(b.login).toBe('new')
    expect(b.name).toBe('N')
  })

  test('listForUser: mine vs shared, starred first', async () => {
    const a = await mkUser(1)
    const b = await mkUser(2)
    const p1 = await mk(a.id, 'one')
    const p2 = await mk(b.id, 'two', 'editor')
    await touchMember(sql, p1.id, a.id); await touchMember(sql, p2.id, a.id)
    await setStarred(sql, p2.id, a.id, true)
    expect((await listForUser(sql, a.id, 'any', 'opened')).map(r => r.id)).toEqual([p2.id, p1.id])
    expect((await listForUser(sql, a.id, 'shared', 'opened')).map(r => r.id)).toEqual([p2.id])
    expect((await listForUser(sql, a.id, 'mine', 'opened')).map(r => r.id)).toEqual([p1.id])
    const row = (await listForUser(sql, a.id, 'any', 'opened'))[0]!
    expect(row).toMatchObject({ starred: true, ownerLogin: 'u2', isOwner: false, title: 'two' })
    expect(row.lastOpenedAt).toBeInstanceOf(Date)
  })

  test('listForUser: title sort is case-insensitive, starred first; opened sorts by recency', async () => {
    const a = await mkUser(3)
    const pb = await mk(a.id, 'banana'); const pa = await mk(a.id, 'Apple'); const pc = await mk(a.id, 'cherry')
    for (const p of [pb, pa, pc]) await touchMember(sql, p.id, a.id)
    await sql`update project_members set last_opened_at = now() - interval '1 hour' where project_id = ${pa.id}`
    await setStarred(sql, pc.id, a.id, true)
    expect((await listForUser(sql, a.id, 'any', 'title')).map(r => r.title)).toEqual(['cherry', 'Apple', 'banana'])
    expect((await listForUser(sql, a.id, 'any', 'opened')).map(r => r.title)).toEqual(['cherry', 'banana', 'Apple'])
  })

  test('listForUser: guest-owned project has null ownerLogin', async () => {
    const a = await mkUser(4)
    const g = await insertProject(sql, { ownerGuestId: 'guest1', title: 'g', template: 'blank', linkAccess: 'editor', isDemoCopy: true })
    await touchMember(sql, g.id, a.id)
    const rows = await listForUser(sql, a.id, 'shared', 'opened')
    expect(rows[0]).toMatchObject({ id: g.id, ownerLogin: null, isOwner: false })
  })

  test('owner check constraint', async () => {
    await expect(insertProject(sql, { ownerId: null, ownerGuestId: null, title: 't', template: 'blank', linkAccess: 'editor' } as any)).rejects.toThrow()
    const a = await mkUser(5)
    await expect(insertProject(sql, { ownerId: a.id, ownerGuestId: 'g', title: 't', template: 'blank', linkAccess: 'editor' })).rejects.toThrow()
  })

  test('mutators, members, count, delete', async () => {
    const a = await mkUser(6); const b = await mkUser(7)
    const p = await mk(a.id, 'x')
    const demo = await insertProject(sql, { ownerId: a.id, title: 'd', template: 'blank', linkAccess: 'editor', isDemoCopy: true })
    expect(await countOwned(sql, a.id)).toBe(1)
    await setTitle(sql, p.id, 'y'); await setLinkAccess(sql, p.id, 'viewer')
    const got = (await getProject(sql, p.id))!
    expect(got).toMatchObject({ title: 'y', linkAccess: 'viewer', ownerId: a.id, isDemoCopy: false })
    await touchMember(sql, p.id, a.id); await touchMember(sql, p.id, b.id)
    expect((await listMembers(sql, p.id)).map(m => m.userId).sort()).toEqual([a.id, b.id].sort())
    await removeMember(sql, p.id, b.id)
    expect((await listMembers(sql, p.id)).map(m => m.userId)).toEqual([a.id])
    const before = got.lastActiveAt
    await new Promise(r => setTimeout(r, 5))
    await touchActive(sql, p.id)
    expect((await getProject(sql, p.id))!.lastActiveAt.getTime()).toBeGreaterThan(before.getTime())
    await deleteProject(sql, p.id)
    expect(await getProject(sql, p.id)).toBeNull()
    expect(await listMembers(sql, p.id)).toEqual([])
    void demo
  })

  test('storeDoc updates title, preview and total', async () => {
    const a = await mkUser(8)
    const p = await mk(a.id, 'old')
    const base = await totalStoredBytes(sql)
    expect(await loadDoc(sql, p.id)).toBeNull()
    await storeDoc(sql, p.id, new Uint8Array(100), 'prev', 'New')
    const got = (await getProject(sql, p.id))!
    expect(got.title).toBe('New'); expect(got.previewText).toBe('prev')
    expect(await totalStoredBytes(sql)).toBe(base + 100)
    await storeDoc(sql, p.id, new Uint8Array([1, 2, 3]), 'p2', 'New')
    expect(Array.from((await loadDoc(sql, p.id))!)).toEqual([1, 2, 3])
    expect(await totalStoredBytes(sql)).toBe(base + 3)
    await deleteProject(sql, p.id)
    expect(await totalStoredBytes(sql)).toBe(base)
  })
})
