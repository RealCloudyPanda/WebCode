import { defineConfig } from 'vitest/config'

// Starter templates under templates/ are not part of this package's tests.
export default defineConfig({
  test: { exclude: ['**/node_modules/**', 'templates/**'] },
})
