import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Sql } from 'postgres'
import WebSocket from 'ws'
import * as Y from 'yjs'
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider'
import { docToFiles, getFiles, getMeta, LIMITS } from '@webcode/shared'
import { dbSkipReason, setupTestDb, TEST_DB_URL } from '../../test/db-helpers'
import { loadConfig } from '../config.js'
import { signGuest } from '../auth/guest.js'
import { viewerFromCookieHeader } from '../auth/identify.js'
import { createSession } from '../db/sessions.js'
import { upsertGithubUser } from '../db/users.js'
import { getProject, setLinkAccess } from '../db/projects.js'
import { loadDoc } from '../db/docs.js'
import { createProjectFromFiles } from '../projects/create.js'
import { createCollab, type CollabLimits } from './hub.js'
import type { CollabHub } from './types.js'

const SECRET = 'test-secret'
const config = loadConfig({ PUBLIC_URL: 'http://localhost:5173', SESSION_SECRET: SECRET })

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
async function waitFor(check: () => boolean | Promise<boolean>, timeout = 3000): Promise<void> {
  const end = Date.now() + timeout
  while (!(await check())) {
    if (Date.now() > end) throw new Error('waitFor timed out')
    await sleep(20)
  }
}
const settle = () => sleep(250)
const role = (role: string, readOnly: boolean) => ({ type: 'role', role, readOnly })
const roleMsgs = (c: { stateless: unknown[] }) => c.stateless.filter(m => (m as any).type === 'role')

type Client = {
  doc: Y.Doc
  provider: HocuspocusProvider
  stateless: unknown[]
  closedWith(): Promise<number>
}

describe.skipIf(!TEST_DB_URL)(`collab hub (${TEST_DB_URL ? 'postgres' : dbSkipReason})`, () => {
  let sql: Sql
  let teardown: () => Promise<void>
  let hub: CollabHub
  let http: Server
  let url: string
  let clients: Client[] = []

  let n = 500
  const mkUser = async (login: string, name: string | null = login.toUpperCase()) => {
    const u = await upsertGithubUser(sql, { githubId: n++, login, name, avatarUrl: 'x' })
    const s = await createSession(sql, u.id)
    return { id: u.id, cookie: `wc_session=${s.id}` }
  }
  const mkGuest = (guestId: string, name = `Guest ${guestId}`) =>
    `wc_guest=${encodeURIComponent(signGuest({ guestId, name }, SECRET))}`

  let alice: Awaited<ReturnType<typeof mkUser>>
  let bob: Awaited<ReturnType<typeof mkUser>>
  const g1 = mkGuest('g1')
  const g2 = mkGuest('g2')

  const mkProject = async (linkAccess: 'restricted' | 'viewer' | 'editor', files: Record<string, string> = { 'src/a.ts': 'const a = 1\n' }) =>
    (await createProjectFromFiles({ sql }, { userId: alice.id }, files, { title: 'Proj', template: 'blank', linkAccess })).id

  const startHub = async (opts: { limits?: CollabLimits; debounce?: number; maxDebounce?: number } = {}) => {
    hub = createCollab({ sql, config, ...opts })
    http = createServer((_req, res) => { res.statusCode = 404; res.end() })
    http.on('upgrade', (req, socket, head) => hub.handleUpgrade(req, socket, head))
    await new Promise<void>(r => http.listen(0, '127.0.0.1', r))
    url = `ws://127.0.0.1:${(http.address() as AddressInfo).port}/collab`
  }
  const stopHub = async () => {
    for (const c of clients) c.provider.destroy()
    clients = []
    await hub?.destroy()
    await new Promise<void>(r => (http ? http.close(() => r()) : r()))
  }

  /** Connects a provider as `cookie`; resolves once synced, rejects with the auth-failure reason. */
  const connect = (projectId: string, cookie: string): Promise<Client> => {
    class CookieWebSocket extends WebSocket {
      constructor(address: string, protocols?: string | string[]) {
        super(address, protocols, { headers: cookie ? { cookie } : {} })
      }
    }
    const socket = new HocuspocusProviderWebsocket({ url, WebSocketPolyfill: CookieWebSocket, delay: 5000, maxAttempts: 1 })
    const doc = new Y.Doc()
    const stateless: unknown[] = []
    const closes: number[] = []
    const closeWaiters: ((code: number) => void)[] = []
    socket.on('close', ({ event }: { event: { code: number } }) => {
      closes.push(event.code)
      closeWaiters.splice(0).forEach(w => w(event.code))
    })
    return new Promise((resolve, reject) => {
      const provider = new HocuspocusProvider({
        name: projectId, document: doc, websocketProvider: socket,
        onSynced: () => resolve(client),
        onAuthenticationFailed: ({ reason }) => reject(new Error(reason)),
        onStateless: ({ payload }) => { stateless.push(JSON.parse(payload)) },
      })
      // The provider does not own a socket it was handed; destroy both together.
      const destroy = provider.destroy.bind(provider)
      provider.destroy = () => { destroy(); socket.destroy() }
      const client: Client = {
        doc, provider, stateless,
        closedWith: () => closes.length
          ? Promise.resolve(closes[0]!)
          : new Promise(r => closeWaiters.push(r)),
      }
      clients.push(client)
      provider.attach()
    })
  }
  const text = (c: Client, path = 'src/a.ts') => docToFiles(c.doc)[path] ?? ''

  beforeAll(async () => {
    ({ sql, teardown } = await setupTestDb())
    alice = await mkUser('alice')
    bob = await mkUser('bob', null)
  })
  afterAll(async () => { await teardown?.() })
  afterEach(stopHub)

  describe('with default limits', () => {
    beforeEach(() => startHub({ debounce: 50, maxDebounce: 200 }))

    test('editors sync; viewer updates are rejected', async () => {
      const id = await mkProject('editor')
      const a = await connect(id, alice.cookie)
      const e = await connect(id, g1)
      expect(text(e)).toBe('const a = 1\n')
      getFiles(a.doc).get('src/a.ts')!.insert(0, 'hi ')
      await waitFor(() => text(e).startsWith('hi '))
      getFiles(e.doc).get('src/a.ts')!.insert(0, 'yo ')
      await waitFor(() => text(a).startsWith('yo '))

      const vid = await mkProject('viewer')
      const owner = await connect(vid, alice.cookie)
      const v = await connect(vid, g2)
      getFiles(owner.doc).get('src/a.ts')!.insert(0, 'hi')
      await waitFor(() => text(v).startsWith('hi'))
      getFiles(v.doc).get('src/a.ts')!.insert(0, 'X')
      await settle()
      expect(text(owner)).not.toMatch(/^X/)
      expect(text(owner)).toMatch(/^hi/)
    })

    test('each connection is told its starting role right after authenticating', async () => {
      const id = await mkProject('viewer')
      const owner = await connect(id, alice.cookie)
      const v = await connect(id, g1)
      await waitFor(() => roleMsgs(owner).length > 0 && roleMsgs(v).length > 0)
      expect(roleMsgs(owner)).toEqual([role('owner', false)])
      expect(roleMsgs(v)).toEqual([role('viewer', true)])
      const eid = await mkProject('editor')
      const e = await connect(eid, g2)
      await waitFor(() => roleMsgs(e).length > 0)
      expect(roleMsgs(e)).toEqual([role('editor', false)])
    })

    test('restricted project rejects non-owners; owner may connect', async () => {
      const id = await mkProject('restricted')
      await expect(connect(id, bob.cookie)).rejects.toThrow('no-access')
      await expect(connect(id, g1)).rejects.toThrow('no-access')
      await expect(connect(id, alice.cookie)).resolves.toBeDefined()
    })

    test('anonymous without a guest cookie must join first; unknown project is not-found', async () => {
      const id = await mkProject('editor')
      await expect(connect(id, '')).rejects.toThrow('need-guest')
      await expect(connect(id, 'wc_guest=forged.value')).rejects.toThrow('need-guest')
      await expect(connect('no-such-project', alice.cookie)).rejects.toThrow('not-found')
    })

    test('liveCount and liveGuests count established connections', async () => {
      const id = await mkProject('editor')
      expect(hub.liveCount(id)).toBe(0)
      await connect(id, alice.cookie)
      const a = await connect(id, g1)
      await connect(id, g2)
      expect(hub.liveCount(id)).toBe(3)
      expect(hub.liveGuests(id)).toBe(2)
      a.provider.destroy()
      await waitFor(() => hub.liveCount(id) === 2)
      expect(hub.liveGuests(id)).toBe(1)
    })

    test('reevaluateAccess closes revoked connections with 4403 and downgrades to viewer', async () => {
      const id = await mkProject('editor')
      const owner = await connect(id, alice.cookie)
      const g = await connect(id, g1)
      const quiet = await connect(id, g2)
      await waitFor(() => roleMsgs(g).length === 1)
      await setLinkAccess(sql, id, 'viewer'); await hub.reevaluateAccess(id)
      await hub.reevaluateAccess(id) // no change: no second message
      await waitFor(() => roleMsgs(g).length === 2)
      expect(g.stateless).toContainEqual({ type: 'role', role: 'viewer', readOnly: true })
      getFiles(g.doc).get('src/a.ts')!.insert(0, 'X')
      await settle()
      expect(text(owner)).not.toMatch(/^X/)

      // Back to editor. (Use a client that did not type while read-only: a rejected update stays in
      // that client's doc and its later updates depend on it; the real editor blocks typing instead.)
      await setLinkAccess(sql, id, 'editor'); await hub.reevaluateAccess(id)
      await waitFor(() => roleMsgs(quiet).length === 3)
      expect(roleMsgs(quiet)).toEqual([role('editor', false), role('viewer', true), role('editor', false)])
      expect(roleMsgs(owner)).toEqual([role('owner', false)])
      getFiles(quiet.doc).get('src/a.ts')!.insert(0, 'Y')
      await waitFor(() => text(owner).startsWith('Y'))

      await setLinkAccess(sql, id, 'restricted'); await hub.reevaluateAccess(id)
      expect(await g.closedWith()).toBe(4403)
      expect(await quiet.closedWith()).toBe(4403)
      expect(hub.liveCount(id)).toBe(1)
      await settle() // the providers' reconnect attempts are refused too
      expect(hub.liveCount(id)).toBe(1)
    })

    test('closeAll closes every connection with 4404', async () => {
      const id = await mkProject('editor')
      const a = await connect(id, alice.cookie)
      const g = await connect(id, g1)
      hub.closeAll(id, 'deleted')
      expect(await a.closedWith()).toBe(4404)
      expect(await g.closedWith()).toBe(4404)
      expect(hub.liveCount(id)).toBe(0)
    })

    test('persists after all disconnect, refreshing preview text', async () => {
      const id = await mkProject('editor')
      const a = await connect(id, alice.cookie)
      getFiles(a.doc).get('src/a.ts')!.insert(0, '// saved\n')
      await settle()
      a.provider.destroy()
      await waitFor(async () => {
        const state = await loadDoc(sql, id)
        const d = new Y.Doc(); Y.applyUpdate(d, state!)
        return (docToFiles(d)['src/a.ts'] ?? '').startsWith('// saved\n')
      })
      expect((await getProject(sql, id))!.previewText).toBe('// saved\nconst a = 1\n')
    })

    test('setTitle writes meta.title with no live room and into a live room', async () => {
      const id = await mkProject('editor')
      await hub.setTitle(id, 'Renamed')
      const d = new Y.Doc(); Y.applyUpdate(d, (await loadDoc(sql, id))!)
      expect(getMeta(d).get('title')).toBe('Renamed')

      const a = await connect(id, alice.cookie)
      expect(getMeta(a.doc).get('title')).toBe('Renamed')
      await hub.setTitle(id, 'Live title')
      await waitFor(() => getMeta(a.doc).get('title') === 'Live title')
    })

    test('snapshotFiles reads the stored doc when nobody is connected, and the live doc otherwise', async () => {
      const id = await mkProject('editor', { 'README.md': '# hi', 'src/a.ts': 'x' })
      expect(await hub.snapshotFiles(id)).toEqual({ 'README.md': '# hi', 'src/a.ts': 'x' })
      const a = await connect(id, alice.cookie)
      getFiles(a.doc).get('src/a.ts')!.insert(1, 'y')
      await waitFor(async () => (await hub.snapshotFiles(id))['src/a.ts'] === 'xy')
    })
  })

  test('size lock makes non-owners read-only, broadcasts, and unlocks when back under', async () => {
    await startHub({ limits: { ...LIMITS, maxProjectBytes: 2_000 }, debounce: 50, maxDebounce: 200 })
    const id = await mkProject('editor')
    const owner = await connect(id, alice.cookie)
    const e = await connect(id, g1)
    getFiles(owner.doc).get('src/a.ts')!.insert(0, 'z'.repeat(3_000))
    await waitFor(() => e.stateless.some(m => (m as any).type === 'size-locked'))
    expect(e.stateless).toContainEqual({ type: 'size-locked' })
    await waitFor(() => roleMsgs(e).length === 2)
    expect(roleMsgs(e)).toEqual([role('editor', false), role('editor', true)])

    getFiles(e.doc).get('src/a.ts')!.insert(0, 'X')
    await settle()
    expect(text(owner)).not.toMatch(/^X/)
    getFiles(owner.doc).get('src/a.ts')!.insert(0, 'O')
    await waitFor(() => text(e).includes('O')) // e still holds its own rejected 'X' locally

    // A newcomer while locked is read-only and told so.
    const late = await connect(id, g2)
    await waitFor(() => late.stateless.some(m => (m as any).type === 'size-locked'))
    expect(roleMsgs(late)).toEqual([role('editor', true)])

    const t = getFiles(owner.doc).get('src/a.ts')!
    t.delete(0, t.length)
    await waitFor(() => late.stateless.some(m => (m as any).type === 'size-unlocked'))
    await waitFor(() => roleMsgs(late).length === 2)
    expect(roleMsgs(late)).toEqual([role('editor', true), role('editor', false)])
    expect(roleMsgs(owner)).toEqual([role('owner', false)])
    // `late` never typed while locked (see the reevaluateAccess test), so its edits apply again.
    getFiles(late.doc).get('src/a.ts')!.insert(0, 'back')
    await waitFor(() => text(owner).startsWith('back'))
  })

  test('a project already over the limit is locked on load', async () => {
    await startHub({ limits: { ...LIMITS, maxFiles: 1 }, debounce: 50, maxDebounce: 200 })
    const id = await mkProject('editor', { 'a.txt': 'a', 'b.txt': 'b' })
    const owner = await connect(id, alice.cookie)
    const e = await connect(id, g1)
    expect(e.stateless).toContainEqual({ type: 'size-locked' })
    expect(roleMsgs(e)).toEqual([role('editor', true)]) // locked from the start: one message
    getFiles(e.doc).get('a.txt')!.insert(0, 'X')
    await settle()
    expect(text(owner, 'a.txt')).toBe('a')
  })

  test('connections beyond maxConnections are rejected with too-many', async () => {
    await startHub({ limits: { ...LIMITS, maxConnections: 2 } })
    const id = await mkProject('editor')
    await connect(id, alice.cookie)
    await connect(id, g1)
    await expect(connect(id, g2)).rejects.toThrow('too-many')
    expect(hub.liveCount(id)).toBe(2)
  })

  test('viewerFromCookieHeader resolves users, guests and anonymous', async () => {
    expect(await viewerFromCookieHeader(alice.cookie, { sql, config }))
      .toEqual({ viewer: { kind: 'user', userId: alice.id }, displayName: 'ALICE', userId: alice.id })
    expect(await viewerFromCookieHeader(bob.cookie, { sql, config }))
      .toEqual({ viewer: { kind: 'user', userId: bob.id }, displayName: 'bob', userId: bob.id })
    expect(await viewerFromCookieHeader(g1, { sql, config }))
      .toEqual({ viewer: { kind: 'guest', guestId: 'g1' }, displayName: 'Guest g1' })
    expect(await viewerFromCookieHeader(undefined, { sql, config }))
      .toEqual({ viewer: { kind: 'anonymous' }, displayName: '' })
  })
})
