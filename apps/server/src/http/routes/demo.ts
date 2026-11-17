import { Hono, type Context } from 'hono'
import { getConnInfo } from '@hono/node-server/conninfo'
import { LIMITS } from '@webcode/shared'
import type { Deps } from '../app.js'
import { identify } from '../../auth/identify.js'
import { deleteProject } from '../../db/projects.js'
import { ApiFailure } from '../../projects/create.js'
import { countLiveDemos, createDemoCopy, DEMO_BUSY, findGuestCopy } from '../../demo/demo.js'

const HOUR_MS = 60 * 60 * 1000

function clientIp(c: Context): string {
  const fly = c.req.header('fly-client-ip')?.trim()
  if (fly) return fly
  try {
    return getConnInfo(c).remote.address ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

export function demoRoutes(deps: Deps): Hono {
  const { sql, collab, limiter } = deps
  const app = new Hono()
  const now = () => deps.now?.().getTime() ?? Date.now()
  const err = (c: Context, status: 401 | 404 | 429 | 503, error: string, message?: string) =>
    c.json(message ? { error, message } : { error }, status)

  const ipAllowed = (c: Context) => limiter.hit(`demo:${clientIp(c)}`, LIMITS.maxDemoPerIpPerHour, HOUR_MS, now())

  async function create(c: Context, guestId: string) {
    try {
      return c.json({ id: (await createDemoCopy(deps, guestId)).id })
    } catch (e) {
      if (e instanceof ApiFailure && (e.status === 429 || e.status === 503)) return err(c, e.status, e.code, e.message === e.code ? undefined : e.message)
      throw e
    }
  }

  app.post('/api/demo', async c => {
    const { guest } = await identify(c, deps)
    if (!guest) return err(c, 401, 'need-guest')
    const existing = await findGuestCopy(sql, guest.guestId)
    if (existing) return c.json({ id: existing.id })
    if ((await countLiveDemos(sql)) >= LIMITS.maxLiveDemos) return err(c, 503, 'busy', DEMO_BUSY)
    if (!ipAllowed(c)) return err(c, 429, 'rate-limited', DEMO_BUSY)
    return create(c, guest.guestId)
  })

  app.post('/api/demo/start-over', async c => {
    const { guest } = await identify(c, deps)
    if (!guest) return err(c, 401, 'need-guest')
    const old = await findGuestCopy(sql, guest.guestId)
    if (!old) return err(c, 404, 'not-found')
    // Replacing one copy with another leaves the live count unchanged, so the site-wide cap is not re-checked.
    // The new copy is created before the old one is removed so a failure keeps the visitor's work.
    if (!ipAllowed(c)) return err(c, 429, 'rate-limited', DEMO_BUSY)
    const res = await create(c, guest.guestId)
    if (res.status !== 200) return res
    collab.closeAll(old.id, 'deleted')
    await deleteProject(sql, old.id)
    return res
  })

  return app
}
