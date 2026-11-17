import postgres, { type Sql } from 'postgres'

export type { Sql }

export function createDb(url: string): Sql {
  // Neon's pooled endpoint (-pooler) is PgBouncer in transaction mode: skip named prepared statements there.
  const pooled = /-pooler\./.test(url)
  return postgres(url, { onnotice: () => {}, transform: { undefined: null }, prepare: !pooled })
}
