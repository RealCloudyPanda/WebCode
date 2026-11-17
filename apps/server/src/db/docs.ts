import type { Sql } from 'postgres'

export async function loadDoc(sql: Sql, projectId: string): Promise<Uint8Array | null> {
  const [row] = await sql`select yjs_state from project_docs where project_id = ${projectId}`
  return row ? new Uint8Array(row.yjs_state) : null
}

/** Upserts the Yjs state and refreshes the project's title, preview and updated_at. */
export async function storeDoc(
  sql: Sql, projectId: string, state: Uint8Array, previewText: string, title: string,
): Promise<void> {
  await sql.begin(async tx => {
    await tx`
      insert into project_docs (project_id, yjs_state, stored_bytes)
      values (${projectId}, ${Buffer.from(state)}, ${state.byteLength})
      on conflict (project_id) do update
        set yjs_state = excluded.yjs_state, stored_bytes = excluded.stored_bytes, updated_at = now()`
    await tx`
      update projects set title = ${title}, preview_text = ${previewText}, updated_at = now()
      where id = ${projectId}`
  })
}

export async function totalStoredBytes(sql: Sql): Promise<number> {
  const [row] = await sql`select coalesce(sum(stored_bytes), 0)::float8 as n from project_docs`
  return Number(row!.n)
}
