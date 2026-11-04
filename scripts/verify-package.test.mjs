import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  macSignatureChecks,
  parseVerifyArgs,
  validateArchiveEntries,
  validateFuseSettings
} from './verify-package.mjs'

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
test('reads the signing level from the command line, keeping --require-signed as trusted', () => {
  assert.deepEqual(parseVerifyArgs(['dist']), { directory: 'dist', signing: 'none' })
  assert.deepEqual(parseVerifyArgs(['dist', '--signing=adhoc']), {
    directory: 'dist',
    signing: 'adhoc'
  })
  assert.deepEqual(parseVerifyArgs(['dist', '--require-signed']), {
    directory: 'dist',
    signing: 'trusted'
  })
  assert.throws(() => parseVerifyArgs(['dist', '--signing=maybe']), /signing level/)
  assert.throws(() => parseVerifyArgs([]), /Usage/)
})
test('an ad-hoc Mac build is checked for a valid signature but not for Gatekeeper approval', () => {
  assert.deepEqual(macSignatureChecks('none', '/dist/Megatron.app'), [])
  assert.deepEqual(macSignatureChecks('adhoc', '/dist/Megatron.app'), [
    ['/usr/bin/codesign', ['--verify', '--deep', '--strict', '/dist/Megatron.app']]
  ])
  assert.deepEqual(
    macSignatureChecks('trusted', '/dist/Megatron.app').map(([command]) => command),
    ['/usr/bin/codesign', '/usr/sbin/spctl', '/usr/bin/xcrun']
  )
})
