import { serve } from '@hono/node-server'
import type { Server } from 'node:http'
import type { Duplex } from 'node:stream'
import { loadConfig } from './config.js'
import { createDb } from './db/db.js'
import { migrate } from './db/migrate.js'
import { createApp } from './http/app.js'
import { createCollab } from './collab/hub.js'
import { createGithubClient } from './auth/github.js'
import { cleanupExpiredDemos } from './demo/demo.js'
import { RateLimiter } from './util/rate-limit.js'

const config = loadConfig()
const sql = createDb(config.databaseUrl)
await migrate(sql)

const github = createGithubClient(config)
const collab = createCollab({ sql, config })
const app = createApp({ sql, config, github, collab, limiter: new RateLimiter() })

const runCleanup = async () => {
  try {
    const n = await cleanupExpiredDemos({ sql, collab }, new Date())
    if (n > 0) console.log(`[demo] cleaned up ${n} idle demo cop${n === 1 ? 'y' : 'ies'}`)
  } catch (err) {
    console.error('[demo] cleanup failed:', err instanceof Error ? err.message : 'unknown error')
  }
}
void runCleanup()
const cleanupTimer = setInterval(() => { void runCleanup() }, 60 * 60 * 1000)
cleanupTimer.unref()

const server = serve({ fetch: app.fetch, port: config.port }, info => {
  console.log(`webcode server listening on :${info.port}`)
}) as Server

server.on('upgrade', (req, socket: Duplex, head) => {
  if (new URL(req.url ?? '/', 'http://x').pathname === '/collab') collab.handleUpgrade(req, socket, head)
  else socket.destroy()
})

let closing = false
async function shutdown() {
  if (closing) return
  closing = true
  clearInterval(cleanupTimer)
  const closed = new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections?.() })
  // Upgraded WebSockets keep server.close() pending, so close them (and flush docs) first.
  await collab.destroy()
  await closed
  await sql.end()
  process.exit(0)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
