import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Sql } from 'postgres'

const dir = fileURLToPath(new URL('./migrations/', import.meta.url))

/** Applies migrations/*.sql in filename order, once each. Serialized by an advisory lock. */
export async function migrate(sql: Sql): Promise<void> {
  const files = readdirSync(dir).filter(f => f.endsWith('.sql')).sort()
  await sql.begin(async tx => {
    // Lock is keyed per database; held until this transaction ends.
    await tx`select pg_advisory_xact_lock(748201)`
    await tx`create table if not exists schema_migrations (
      name text primary key, applied_at timestamptz not null default now())`
    const done = new Set((await tx`select name from schema_migrations`).map(r => r.name as string))
    for (const f of files) {
      if (done.has(f)) continue
      await tx.unsafe(readFileSync(dir + f, 'utf8'))
      await tx`insert into schema_migrations (name) values (${f})`
    }
  })
}
