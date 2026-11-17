import { randomUUID } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer, type RawData } from 'ws'
import * as Y from 'yjs'
import { Hocuspocus, type Connection, type Document } from '@hocuspocus/server'
import { Database } from '@hocuspocus/extension-database'
import {
  docStats, docToFiles, getFiles, getMeta, LIMITS, pickColor, previewText, resolveAccess,
  type Role, type Viewer,
} from '@webcode/shared'
import type { Config } from '../config.js'
import type { Sql } from '../db/db.js'
import { loadDoc, storeDoc } from '../db/docs.js'
import { getProject, touchActive } from '../db/projects.js'
import { viewerFromCookieHeader } from '../auth/identify.js'
import type { CollabHub } from './types.js'

export type CollabLimits = { maxConnections: number; maxProjectBytes: number; maxFiles: number }

/** Per-connection context. `socketKey` identifies the WebSocket; the rest is set by onAuthenticate. */
export type CollabContext = {
  socketKey: string
  viewer: Viewer
  role: Role
  displayName: string
  color: string
  userId?: string
}

/** Thrown from onAuthenticate; Hocuspocus sends `reason` to the client as a permission-denied message. */
type Denial = { reason: 'not-found' | 'no-access' | 'need-guest' | 'too-many' }
const deny = (reason: Denial['reason']): Denial => ({ reason })

const CLOSE_REVOKED = { code: 4403, reason: 'access-revoked' } as const
const CLOSE_DELETED = { code: 4404, reason: 'deleted' } as const
const DELETED_MEMORY_MS = 60_000

const ctxOf = (c: Connection) => c.context as CollabContext
const viewerKey = (v: Viewer) => (v.kind === 'user' ? v.userId : v.kind === 'guest' ? v.guestId : 'anonymous')

function toBytes(data: RawData): Uint8Array {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data))
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
}

function toRequest(req: IncomingMessage): Request {
  const headers = new Headers()
  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) v.forEach(x => headers.append(k, x))
    else if (v !== undefined) headers.set(k, v)
  }
  return new Request(new URL(req.url ?? '/', 'http://localhost'), { headers })
}

export function createCollab(deps: {
  sql: Sql
  config: Config
  limits?: CollabLimits
  debounce?: number
  maxDebounce?: number
  /** Test seam: awaited in onAuthenticate right after the project row is read. */
  afterAuthProjectRead?: (projectId: string) => Promise<void>
}): CollabHub {
  const { sql, config, limits = LIMITS, debounce = 2000, maxDebounce = 10000, afterAuthProjectRead } = deps

  /** Projects whose stored size or file count is over the limit: only the owner may edit. */
  const locked = new Set<string>()
  /** Projects closed for deletion: their pending stores are dropped and late joiners are closed. */
  const deleted = new Set<string>()
  /** Keys of sockets that are still open; a slot is only reserved for one of these. */
  const openSockets = new Set<string>()
  /** Authenticated sockets not yet attached to the document, per project (counted against maxConnections). */
  const pending = new Map<string, Set<string>>()

  const release = (projectId: string, socketKey: string) => {
    const set = pending.get(projectId)
    if (!set) return
    set.delete(socketKey)
    if (!set.size) pending.delete(projectId)
  }
  const releaseSocket = (socketKey: string) => {
    for (const projectId of [...pending.keys()]) release(projectId, socketKey)
  }

  const isReadOnly = (projectId: string, role: Role) =>
    role === 'viewer' || (role !== 'owner' && locked.has(projectId))

  const liveDoc = (projectId: string) => hocuspocus.documents.get(projectId)
  const connectionsOf = (projectId: string) => liveDoc(projectId)?.getConnections() ?? []

  /** Tells this connection's client its role and whether its edits are accepted (it locks the editor). */
  const sendRole = (c: Connection) =>
    c.sendStateless(JSON.stringify({ type: 'role', role: ctxOf(c).role, readOnly: c.readOnly }))

  /** Sets a live connection's role and read-only flag, notifying its client when either changes. */
  const applyAccess = (c: Connection, role: Role) => {
    const ctx = ctxOf(c)
    const readOnly = isReadOnly(c.document.name, role)
    if (ctx.role === role && c.readOnly === readOnly) return
    ctx.role = role
    c.readOnly = readOnly
    sendRole(c)
  }

  /** Recomputes the size lock; on a change, updates every connection's read-only flag and tells clients. */
  const updateLock = (document: Document, stats: { storedBytes: number; fileCount: number }) => {
    const over = stats.storedBytes > limits.maxProjectBytes || stats.fileCount > limits.maxFiles
    if (over === locked.has(document.name)) return
    if (over) locked.add(document.name)
    else locked.delete(document.name)
    for (const c of document.getConnections()) applyAccess(c, ctxOf(c).role)
    document.broadcastStateless(JSON.stringify({ type: over ? 'size-locked' : 'size-unlocked' }))
  }

  /** Detaches the connection from its document, then closes its socket with an app close code. */
  const kick = (c: Connection, event: { code: number; reason: string }) => {
    c.close(event)
    c.webSocket.close(event.code, event.reason)
  }

  const database = new Database({
    fetch: async ({ documentName }) => loadDoc(sql, documentName),
    store: async ({ documentName, document, state }) => {
      if (deleted.has(documentName)) return
      const title = getMeta(document).get('title') ?? (await getProject(sql, documentName))?.title
      if (title === undefined) return
      await storeDoc(sql, documentName, state, previewText(docToFiles(document)), title)
      await touchActive(sql, documentName)
      updateLock(document, { storedBytes: state.byteLength, fileCount: getFiles(document).size })
    },
  })

  const hocuspocus = new Hocuspocus({
    quiet: true,
    debounce,
    maxDebounce,
    extensions: [database],

    async onAuthenticate({ documentName, requestHeaders, connectionConfig, context }) {
      const { socketKey } = context as CollabContext
      const project = await getProject(sql, documentName)
      if (!project || deleted.has(documentName)) throw deny('not-found')
      await afterAuthProjectRead?.(documentName)
      const who = await viewerFromCookieHeader(requestHeaders.get('cookie') ?? undefined, { sql, config })
      const role = resolveAccess(project, who.viewer)
      if (role === 'none') throw deny('no-access')
      if (who.viewer.kind === 'anonymous') throw deny('need-guest')
      // The socket may have closed during the awaits above; its close handler has already released
      // its reservations, so reserving now would leak the slot forever.
      if (!openSockets.has(socketKey)) throw deny('no-access')
      const reserved = pending.get(documentName) ?? new Set<string>()
      if (connectionsOf(documentName).length + reserved.size >= limits.maxConnections) throw deny('too-many')
      reserved.add(socketKey)
      pending.set(documentName, reserved)
      connectionConfig.readOnly = isReadOnly(documentName, role)
      const added: Omit<CollabContext, 'socketKey'> = {
        viewer: who.viewer, role, displayName: who.displayName, color: pickColor(viewerKey(who.viewer)),
        ...(who.userId ? { userId: who.userId } : {}),
      }
      return added
    },

    async afterLoadDocument({ document }) {
      updateLock(document, docStats(document))
    },

    async connected({ documentName, connection }) {
      const ctx = ctxOf(connection)
      release(documentName, ctx.socketKey)
      if (deleted.has(documentName)) { kick(connection, CLOSE_DELETED); return }
      // Starting role (the size lock may have changed since authentication).
      connection.readOnly = isReadOnly(documentName, ctx.role)
      sendRole(connection)
      if (locked.has(documentName)) connection.sendStateless(JSON.stringify({ type: 'size-locked' }))
      // Access may have changed, or the project been deleted, after onAuthenticate read the project
      // but before this connection was attached, i.e. after reevaluateAccess/closeAll looked at the
      // room. Re-reading now that it is attached closes that gap: later changes will see it.
      const project = await getProject(sql, documentName)
      if (!connection.document.hasConnection(connection)) return // closed meanwhile
      if (!project || deleted.has(documentName)) { kick(connection, CLOSE_DELETED); return }
      const role = resolveAccess(project, ctx.viewer)
      if (role === 'none') { kick(connection, CLOSE_REVOKED); return }
      applyAccess(connection, role)
      await touchActive(sql, documentName)
    },

    async afterUnloadDocument({ documentName }) {
      locked.delete(documentName)
    },
  })

  const wss = new WebSocketServer({ noServer: true })

  return {
    handleUpgrade(req, socket: Duplex, head) {
      wss.handleUpgrade(req, socket, head, ws => {
        const socketKey = randomUUID()
        openSockets.add(socketKey)
        const client = hocuspocus.handleConnection(ws, toRequest(req), { socketKey })
        ws.on('message', data => client.handleMessage(toBytes(data)))
        ws.on('pong', () => client.touch())
        ws.on('error', () => ws.terminate())
        ws.on('close', (code, reason) => {
          openSockets.delete(socketKey)
          releaseSocket(socketKey)
          client.handleClose({ code, reason: reason.toString() })
        })
      })
    },

    liveCount: projectId => connectionsOf(projectId).length,

    liveGuests: projectId => connectionsOf(projectId).filter(c => ctxOf(c).viewer.kind === 'guest').length,

    async reevaluateAccess(projectId) {
      if (!liveDoc(projectId)) return
      const project = await getProject(sql, projectId)
      for (const c of connectionsOf(projectId)) {
        const ctx = ctxOf(c)
        const role = project ? resolveAccess(project, ctx.viewer) : 'none'
        if (role === 'none') { kick(c, CLOSE_REVOKED); continue }
        applyAccess(c, role)
      }
    },

    closeAll(projectId) {
      // Kept for a while (not just until unload) so sockets still mid-auth are refused or closed
      // even if the room unloads before they attach; the project row is gone by then.
      deleted.add(projectId)
      setTimeout(() => deleted.delete(projectId), DELETED_MEMORY_MS).unref()
      for (const c of connectionsOf(projectId)) kick(c, CLOSE_DELETED)
    },

    async setTitle(projectId, title) {
      const direct = await hocuspocus.openDirectConnection(projectId)
      try {
        await direct.transact(doc => { getMeta(doc).set('title', title) })
      } finally {
        await direct.disconnect() // stores immediately and unloads if nobody else is connected
      }
    },

    async snapshotFiles(projectId) {
      const live = liveDoc(projectId)
      if (live && !live.isLoading) return docToFiles(live)
      const state = await loadDoc(sql, projectId)
      const doc = new Y.Doc()
      try {
        if (state) Y.applyUpdate(doc, state)
        return docToFiles(doc)
      } finally {
        doc.destroy()
      }
    },

    async destroy() {
      hocuspocus.closeConnections()
      for (const ws of wss.clients) ws.terminate()
      hocuspocus.flushPendingStores()
      const end = Date.now() + 5000
      while (hocuspocus.getDocumentsCount() > 0 && Date.now() < end) await new Promise(r => setTimeout(r, 20))
      await new Promise<void>(r => wss.close(() => r()))
    },
  }
}
