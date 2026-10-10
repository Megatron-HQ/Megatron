import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateArchiveEntries, validateFuseSettings } from './verify-package.mjs'

test('allows compiled runtime files and production dependencies', () => {
  assert.doesNotThrow(() =>
    validateArchiveEntries([
      '/out/main/index.js',
      '/out/main/scan-worker.js',
      '/out/preload/index.cjs',
      '/out/renderer/index.html',
      '/node_modules/yaml/package.json',
      '/package.json'
    ])
  )
})
test('rejects developer files and sensitive files even below a permitted directory', () => {
  for (const entry of [
    '/src/main/index.ts',
    '/.claude/settings.json',
    '/references/nested/.env',
    '/out/main/.env.production',
    '/node_modules/example/.npmrc',
    '/out/debug.log'
  ])
    assert.throws(() => validateArchiveEntries([entry]))
})
test('rejects an unsafe or missing Electron fuse', () => {
  const safe = {
    runAsNode: false,
    enableNodeOptionsEnvironmentVariable: false,
    enableNodeCliInspectArguments: false,
    enableEmbeddedAsarIntegrityValidation: true,
    onlyLoadAppFromAsar: true,
    grantFileProtocolExtraPrivileges: false
  }
  assert.doesNotThrow(() => validateFuseSettings(safe))
  for (const name of Object.keys(safe)) {
    assert.throws(() => validateFuseSettings({ ...safe, [name]: !safe[name] }))
    const missing = { ...safe }
    delete missing[name]
    assert.throws(() => validateFuseSettings(missing))
  }
})
