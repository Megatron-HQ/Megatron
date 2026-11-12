import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  macSignatureChecks,
  parseVerifyArgs,
  validateArchiveEntries,
  validateFuseSettings,
  validateUnpackedEntries
} from './verify-package.mjs'

const SQLITE = 'node_modules/better-sqlite3'
const WINDOWS_X64 = { platform: 'win32', arch: 'x64' }
const slimWindowsPayload = [
  'resources/icon.ico',
  'resources/icon.png',
  `${SQLITE}/package.json`,
  `${SQLITE}/LICENSE`,
  `${SQLITE}/lib/index.js`,
  `${SQLITE}/lib/binding.js`,
  `${SQLITE}/lib/methods/transaction.js`,
  `${SQLITE}/prebuilds/win32-x64.node`
]

test('accepts the native SQLite runtime for the target platform and nothing more', () => {
  assert.doesNotThrow(() => validateUnpackedEntries(slimWindowsPayload, WINDOWS_X64))
  assert.doesNotThrow(() =>
    validateUnpackedEntries(
      [`${SQLITE}/package.json`, `${SQLITE}/lib/index.js`, `${SQLITE}/prebuilds/darwin-arm64.node`],
      { platform: 'darwin', arch: 'arm64' }
    )
  )
})
test('rejects native builds for other platforms and SQLite build leftovers', () => {
  for (const extra of [
    `${SQLITE}/prebuilds/darwin-arm64.node`,
    `${SQLITE}/prebuilds/win32-arm64.node`,
    `${SQLITE}/deps/sqlite3/sqlite3.c`,
    `${SQLITE}/src/addon.cpp`,
    `${SQLITE}/build/Release/obj/better_sqlite3/better_sqlite3.tlog/Cl.items.tlog`,
    `${SQLITE}/binding.gyp`
  ])
    assert.throws(
      () => validateUnpackedEntries([...slimWindowsPayload, extra], WINDOWS_X64),
      /Unexpected unpacked file/
    )
})
test('requires the native SQLite build for the target platform', () => {
  assert.throws(
    () =>
      validateUnpackedEntries(
        slimWindowsPayload.filter((file) => !file.endsWith('win32-x64.node')),
        WINDOWS_X64
      ),
    /Missing native SQLite build: .*win32-x64\.node/
  )
})
test('rejects unpacked files outside the native SQLite runtime and app icons', () => {
  for (const extra of [
    'node_modules/other-native/build/addon.node',
    'out/main/index.js',
    'secret.txt'
  ])
    assert.throws(
      () => validateUnpackedEntries([...slimWindowsPayload, extra], WINDOWS_X64),
      /Unexpected unpacked file/
    )
})

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
