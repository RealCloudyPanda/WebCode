import { describe, expect, test } from 'vitest'
import { loadConfig } from './config'

describe('loadConfig', () => {
  test('dev defaults', () => {
    const c = loadConfig({})
    expect(c).toMatchObject({ port: 8080, publicUrl: 'http://localhost:5173', e2eTestLogin: false, isProd: false })
    expect(c.webDistDir.endsWith('apps/web/dist')).toBe(true)
  })
  test('flags and overrides', () => {
    const c = loadConfig({ E2E_TEST_LOGIN: '1', PORT: '9000', WEB_DIST_DIR: '/x' })
    expect(c).toMatchObject({ e2eTestLogin: true, port: 9000, webDistDir: '/x' })
  })
  test('production lists missing vars', () => {
    expect(() => loadConfig({ NODE_ENV: 'production', GITHUB_CLIENT_ID: 'a' })).toThrow(/DATABASE_URL.*GITHUB_CLIENT_SECRET.*SESSION_SECRET.*PUBLIC_URL/s)
  })
  test('production ok', () => {
    const c = loadConfig({ NODE_ENV: 'production', DATABASE_URL: 'd', GITHUB_CLIENT_ID: 'a', GITHUB_CLIENT_SECRET: 'b', SESSION_SECRET: 'c', PUBLIC_URL: 'https://x' })
    expect(c.isProd).toBe(true)
    expect(c.databaseUrl).toBe('d')
  })
})
