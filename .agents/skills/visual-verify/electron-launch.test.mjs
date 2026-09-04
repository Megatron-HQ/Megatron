import assert from 'node:assert/strict'
import test from 'node:test'

test('launches Electron with GPU work in-process before the app entrypoint', async () => {
  const launch = await import('./electron-launch.mjs').catch(() => null)
  const args =
    launch?.visualVerifierLaunchArgs?.(
      'C:\\Megatron\\out\\main\\index.js',
      'C:\\Temp\\megatron-visual-verify'
    ) ?? []

  assert.deepEqual(args, [
    '--in-process-gpu',
    'C:\\Megatron\\out\\main\\index.js',
    '--user-data-dir=C:\\Temp\\megatron-visual-verify'
  ])
})
