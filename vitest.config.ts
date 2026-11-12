import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    globalSetup: ['./scripts/vitest-install-electron.mjs'],
    testTimeout: 20_000
  }
})
