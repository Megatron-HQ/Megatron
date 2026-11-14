import assert from 'node:assert/strict'
import test from 'node:test'

import { visualVerifierLaunchArgs } from './electron-launch.mjs'

test('Windows keeps GPU work in-process, before the app entrypoint', () => {
  const args = visualVerifierLaunchArgs(
    'C:\\Megatron\\out\\main\\index.js',
    'C:\\Temp\\megatron-visual-verify',
    'win32'
  )

  assert.deepEqual(args, [
    '--in-process-gpu',
    'C:\\Megatron\\out\\main\\index.js',
    '--user-data-dir=C:\\Temp\\megatron-visual-verify'
  ])
})

test('non-Windows platforms omit --in-process-gpu (Windows-only crash workaround)', () => {
  for (const platform of ['darwin', 'linux']) {
    const args = visualVerifierLaunchArgs(
      '/repo/out/main/index.js',
      '/tmp/megatron-visual-verify',
      platform
    )

    assert.deepEqual(args, [
      '/repo/out/main/index.js',
      '--user-data-dir=/tmp/megatron-visual-verify'
    ])
    assert.ok(!args.includes('--in-process-gpu'))
  }
})

test('defaults to the host platform when none is passed', () => {
  const args = visualVerifierLaunchArgs('/repo/out/main/index.js', '/tmp/x')
  assert.equal(args.includes('--in-process-gpu'), process.platform === 'win32')
})
