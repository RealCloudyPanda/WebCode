import { Hono, type Context } from 'hono'
import {
  LIMITS, resolveAccess,
  type LinkAccess, type ProjectDetail, type ProjectSummary, type Role, type Viewer,
} from '@webcode/shared'
import type { Deps } from '../app.js'
import { identify, type Identity } from '../../auth/identify.js'
import {
  countOwned, deleteProject, getProject, listForUser, listMembers, removeMember,
  setLinkAccess, setStarred, setTitle, touchMember, type Project,
} from '../../db/projects.js'
import { ApiFailure, createProjectFromFiles } from '../../projects/create.js'
import { loadTemplate, TEMPLATES, type TemplateName } from '../../templates/index.js'

type Env = { Variables: { id: Identity } }

const HOUR_MS = 60 * 60 * 1000
const LINK_ACCESS: readonly string[] = ['restricted', 'viewer', 'editor']

const err = (c: Context, status: 400 | 401 | 403 | 404 | 409 | 429 | 501 | 503, error: string, message?: string) =>
  c.json(message ? { error, message } : { error }, status)

async function readBody(c: Context): Promise<Record<string, unknown> | null> {
  try {
    const b = await c.req.json()
    return b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export function projectRoutes(deps: Deps): Hono<Env> {
  const { sql, collab, limiter } = deps
  const app = new Hono<Env>()

  // identify() renews the session cookie, so run it exactly once per request.
  app.use('/api/projects', async (c, next) => { c.set('id', await identify(c, deps)); await next() })
  app.use('/api/projects/*', async (c, next) => { c.set('id', await identify(c, deps)); await next() })

  const roleOf = (p: Project, viewer: Viewer): Role => resolveAccess(p, viewer)

  async function detail(p: Project, viewer: Viewer): Promise<ProjectDetail> {
    const members = await listMembers(sql, p.id)
    return {
      id: p.id, title: p.title, role: roleOf(p, viewer), linkAccess: p.linkAccess,
      isDemoCopy: p.isDemoCopy, expiresAt: p.expiresAt ? p.expiresAt.toISOString() : null,
      people: members.map(m => ({
        userId: m.userId, login: m.login, name: m.name,
        role: roleOf(p, { kind: 'user', userId: m.userId }),
      })),
      guestCount: collab.liveGuests(p.id),
    }
  }

  /** Shared gate for create/import/copy: signed-in, rate limit, project cap. Returns an error response or the user id. */
  async function createGate(c: Context<Env>): Promise<Response | string> {
    const { user } = c.get('id')
    if (!user) return err(c, 401, 'sign-in-required')
    if (!limiter.hit(`create:${user.id}`, LIMITS.maxCreatesPerHour, HOUR_MS, deps.now?.().getTime())) {
      return err(c, 429, 'rate-limited', 'Too many new projects. Try again later.')
    }
    if ((await countOwned(sql, user.id)) >= LIMITS.maxProjectsPerUser) {
      return err(c, 409, 'project-limit', `You can have up to ${LIMITS.maxProjectsPerUser} projects`)
    }
    return user.id
  }

  const failure = (c: Context, e: unknown) => {
    if (e instanceof ApiFailure) return err(c, e.status, e.code, e.message === e.code ? undefined : e.message)
    throw e
  }

  app.get('/api/projects', async c => {
    const { user } = c.get('id')
    if (!user) return err(c, 401, 'sign-in-required')
    const q = c.req.query()
    const filter = q.filter === 'mine' || q.filter === 'shared' ? q.filter : 'any'
    const sort = q.sort === 'title' ? 'title' : 'opened'
    const rows = await listForUser(sql, user.id, filter, sort)
    const out: ProjectSummary[] = rows.map(r => ({
      id: r.id, title: r.title, isOwner: r.isOwner, ownerLogin: r.ownerLogin, starred: r.starred,
      lastOpenedAt: r.lastOpenedAt.toISOString(), previewText: r.previewText, liveCount: collab.liveCount(r.id),
    }))
    return c.json(out)
  })

  app.post('/api/projects', async c => {
    const gate = await createGate(c)
    if (typeof gate !== 'string') return gate
    const body = await readBody(c)
    if (!body) return err(c, 400, 'invalid')
    if (typeof body.importUrl === 'string') return err(c, 501, 'not-implemented')
    const info = TEMPLATES.find(t => t.name === body.template)
    if (!info) return err(c, 400, 'invalid', 'Unknown template')
    try {
      const files = await loadTemplate(info.name as TemplateName)
      const p = await createProjectFromFiles({ sql }, { userId: gate }, files, {
        title: info.name === 'blank' ? 'Untitled project' : info.label, template: info.name, linkAccess: 'restricted',
      })
      return c.json({ id: p.id })
    } catch (e) { return failure(c, e) }
  })

  app.get('/api/projects/:id', async c => {
    const { viewer, user } = c.get('id')
    const p = await getProject(sql, c.req.param('id'))
    if (!p) return err(c, 404, 'not-found')
    if (roleOf(p, viewer) === 'none') return err(c, 403, 'no-access')
    if (user) await touchMember(sql, p.id, user.id)
    return c.json(await detail(p, viewer))
  })

  app.patch('/api/projects/:id', async c => {
    const { viewer, user } = c.get('id')
    const p = await getProject(sql, c.req.param('id'))
    if (!p) return err(c, 404, 'not-found')
    const role = roleOf(p, viewer)
    if (role === 'none') return err(c, 403, 'no-access')
    const body = await readBody(c)
    if (!body) return err(c, 400, 'invalid')

    let title: string | undefined
    if ('title' in body) {
      if (typeof body.title !== 'string') return err(c, 400, 'invalid')
      title = body.title.trim()
      if (title.length < 1 || title.length > 100) return err(c, 400, 'invalid', 'Title must be 1-100 characters')
      if (role !== 'owner' && role !== 'editor') return err(c, 403, 'no-access')
    }
    let starred: boolean | undefined
    if ('starred' in body) {
      if (typeof body.starred !== 'boolean') return err(c, 400, 'invalid')
      if (!user) return err(c, 401, 'sign-in-required')
      starred = body.starred
    }
    let linkAccess: LinkAccess | undefined
    if ('linkAccess' in body) {
      if (typeof body.linkAccess !== 'string' || !LINK_ACCESS.includes(body.linkAccess)) return err(c, 400, 'invalid')
      if (role !== 'owner') return err(c, 403, 'no-access')
      linkAccess = body.linkAccess as LinkAccess
    }

    if (title !== undefined) { await collab.setTitle(p.id, title); await setTitle(sql, p.id, title) }
    if (starred !== undefined && user) { await touchMember(sql, p.id, user.id); await setStarred(sql, p.id, user.id, starred) }
    if (linkAccess !== undefined) { await setLinkAccess(sql, p.id, linkAccess); await collab.reevaluateAccess(p.id) }

    const fresh = (await getProject(sql, p.id)) ?? p
    return c.json(await detail(fresh, viewer))
  })

  app.delete('/api/projects/:id', async c => {
    const { viewer, user } = c.get('id')
    const p = await getProject(sql, c.req.param('id'))
    if (!p) return err(c, 404, 'not-found')
    if (roleOf(p, viewer) === 'owner') {
      collab.closeAll(p.id, 'deleted')
      await deleteProject(sql, p.id)
      return c.json({ ok: true })
    }
    if (!user) return err(c, 401, 'sign-in-required')
    await removeMember(sql, p.id, user.id)
    return c.json({ ok: true })
  })

  app.post('/api/projects/:id/copy', async c => {
    const gate = await createGate(c)
    if (typeof gate !== 'string') return gate
    const p = await getProject(sql, c.req.param('id'))
    if (!p) return err(c, 404, 'not-found')
    if (roleOf(p, c.get('id').viewer) === 'none') return err(c, 403, 'no-access')
    try {
      const files = await collab.snapshotFiles(p.id)
      const copy = await createProjectFromFiles({ sql }, { userId: gate }, files, {
        title: `Copy of ${p.title}`.slice(0, 100), template: p.template, linkAccess: 'restricted',
      })
      return c.json({ id: copy.id })
    } catch (e) { return failure(c, e) }
  })

  return app
}
