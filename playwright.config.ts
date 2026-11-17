import { defineConfig, devices } from '@playwright/test';

import { BASE_URL as baseURL } from './e2e/fixtures';
const databaseUrl = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL ?? 'postgres://localhost:5432/webcode_e2e';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    // Cookies are Secure except on localhost, so always use the `localhost` host name.
    permissions: ['clipboard-read', 'clipboard-write'],
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // Start from an empty database so per-user project limits never carry over between runs.
    command: `psql "${databaseUrl}" -q -c "drop schema public cascade; create schema public;" && pnpm --filter @webcode/server start`,
    url: `${baseURL}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'pipe',
    env: {
      NODE_ENV: 'test',
      E2E_TEST_LOGIN: '1',
      DATABASE_URL: databaseUrl,
      SESSION_SECRET: 'e2e-session-secret-0123456789abcdef',
      PUBLIC_URL: baseURL,
      PORT: new URL(baseURL).port,
    },
  },
});
