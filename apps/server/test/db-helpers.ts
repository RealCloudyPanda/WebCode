import { randomBytes } from 'node:crypto'
import postgres, { type Sql } from 'postgres'
import { migrate } from '../src/db/migrate'

export const TEST_DB_URL = process.env.DATABASE_URL_TEST
export const dbSkipReason = 'DATABASE_URL_TEST is not set; skipping Postgres tests'
if (!TEST_DB_URL) console.warn(dbSkipReason)

export async function setupTestDb(): Promise<{ sql: Sql; teardown(): Promise<void> }> {
  if (!TEST_DB_URL) throw new Error(dbSkipReason)
  const schema = `t_${randomBytes(8).toString('hex')}`
  const admin = postgres(TEST_DB_URL, { max: 1, onnotice: () => {} })
  await admin.unsafe(`create schema "${schema}"`)
  const sql = postgres(TEST_DB_URL, {
    max: 4,
    onnotice: () => {},
    connection: { search_path: schema },
  })
  await migrate(sql)
  return {
    sql,
    async teardown() {
      await sql.end({ timeout: 5 })
      await admin.unsafe(`drop schema "${schema}" cascade`)
      await admin.end({ timeout: 5 })
    },
  }
}
