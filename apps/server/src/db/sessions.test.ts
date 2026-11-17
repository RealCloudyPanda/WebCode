import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import type { Sql } from 'postgres'
import { dbSkipReason, setupTestDb, TEST_DB_URL } from '../../test/db-helpers'
import { upsertGithubUser } from './users'
import { createSession, deleteSession, getSessionUser } from './sessions'

describe.skipIf(!TEST_DB_URL)(`sessions repo (${TEST_DB_URL ? 'postgres' : dbSkipReason})`, () => {
  let sql: Sql
  let teardown: () => Promise<void>
  let userId: string
  beforeAll(async () => {
    ({ sql, teardown } = await setupTestDb())
    userId = (await upsertGithubUser(sql, { githubId: 1, login: 'a', name: null, avatarUrl: 'x' })).id
  })
  afterAll(async () => { await teardown?.() })

  const expiry = async (id: string) => (await sql`select expires_at from sessions where id = ${id}`)[0]!.expires_at as Date
  const DAY = 86_400_000

  test('create then get returns user; delete removes', async () => {
    const s = await createSession(sql, userId)
    expect(s.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * DAY)
    expect((await getSessionUser(sql, s.id))!.login).toBe('a')
    await deleteSession(sql, s.id)
    expect(await getSessionUser(sql, s.id)).toBeNull()
  })

  test('expired session returns null', async () => {
    const s = await createSession(sql, userId)
    await sql`update sessions set expires_at = now() - interval '1 second' where id = ${s.id}`
    expect(await getSessionUser(sql, s.id)).toBeNull()
  })

  test('unknown session returns null', async () => {
    expect(await getSessionUser(sql, 'nope')).toBeNull()
  })

  test('renews when under 29 days left, not otherwise', async () => {
    const s = await createSession(sql, userId)
    const before = await expiry(s.id)
    await getSessionUser(sql, s.id)
    expect((await expiry(s.id)).getTime()).toBe(before.getTime())
    await sql`update sessions set expires_at = now() + interval '10 days' where id = ${s.id}`
    await getSessionUser(sql, s.id)
    expect((await expiry(s.id)).getTime()).toBeGreaterThan(Date.now() + 29 * DAY)
  })
})
