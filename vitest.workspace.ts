import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  { test: { name: 'shared', root: 'packages/shared', environment: 'node' } },
  { test: { name: 'server', root: 'apps/server', environment: 'node', passWithNoTests: true, exclude: ['**/node_modules/**', 'templates/**'] } },
  {
    extends: 'apps/web/vite.config.ts',
    test: { name: 'web', root: 'apps/web', environment: 'jsdom', passWithNoTests: true },
  },
]);
