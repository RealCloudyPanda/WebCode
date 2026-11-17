import { fileURLToPath } from 'node:url'

export type Config = {
  databaseUrl: string
  /** Direct (non-pooled) URL for migrations; Neon's pooler can't hold session advisory locks. */
  databaseUrlDirect: string
  githubClientId: string
  githubClientSecret: string
  sessionSecret: string
  publicUrl: string
  port: number
  webDistDir: string
  e2eTestLogin: boolean
  isProd: boolean
}

const REQUIRED_IN_PROD = [
  'DATABASE_URL', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'SESSION_SECRET', 'PUBLIC_URL',
] as const

const defaultWebDist = () => fileURLToPath(new URL('../../web/dist', import.meta.url))

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const isProd = env.NODE_ENV === 'production'
  if (isProd) {
    const missing = REQUIRED_IN_PROD.filter(k => !env[k])
    if (missing.length) throw new Error(`Missing required environment variables: ${missing.join(', ')}`)
  }
  return {
    databaseUrl: env.DATABASE_URL ?? 'postgres://localhost:5432/webcode',
    databaseUrlDirect: env.DATABASE_URL_UNPOOLED || env.DATABASE_URL || 'postgres://localhost:5432/webcode',
    githubClientId: env.GITHUB_CLIENT_ID ?? '',
    githubClientSecret: env.GITHUB_CLIENT_SECRET ?? '',
    sessionSecret: env.SESSION_SECRET ?? 'dev-session-secret-change-me',
    publicUrl: env.PUBLIC_URL ?? 'http://localhost:5173',
    port: Number(env.PORT ?? 8080),
    webDistDir: env.WEB_DIST_DIR ?? defaultWebDist(),
    e2eTestLogin: env.E2E_TEST_LOGIN === '1',
    isProd,
  }
}
