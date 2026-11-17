import { Hono } from 'hono'
import type { Deps } from '../app.js'
import { getUser } from '../../db/users.js'

const TTL_MS = 24 * 60 * 60 * 1000
const MAX_ENTRIES = 500

type Entry = { body: Uint8Array; contentType: string; at: number }

export function avatarRoutes(deps: Deps): Hono {
  const app = new Hono()
  const cache = new Map<string, Entry>()
  const now = () => (deps.now ?? (() => new Date()))().getTime()

  app.get('/api/avatar/:userId', async c => {
    const id = c.req.param('userId')
    let hit = cache.get(id)
    if (hit && now() - hit.at >= TTL_MS) { cache.delete(id); hit = undefined }
    if (!hit) {
      const user = await getUser(deps.sql, id)
      if (!user || !user.avatarUrl) return c.json({ error: 'not-found' }, 404)
      let fetched
      try { fetched = await deps.github.fetchAvatar(user.avatarUrl) } catch { return c.json({ error: 'not-found' }, 404) }
      hit = { ...fetched, at: now() }
      cache.delete(id)
      cache.set(id, hit)
      while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!)
    }
    // Build our own Response: a proxied fetch() Response has immutable headers.
    return new Response(new Uint8Array(hit.body), {
      headers: {
        'content-type': hit.contentType,
        'cache-control': 'public, max-age=86400',
        'cross-origin-resource-policy': 'same-origin',
      },
    })
  })

  return app
}
