import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateReleaseEnvironment } from './release-check.mjs'

test('fails before packaging when a required signing setting is missing', () => {
  assert.throws(() => validateReleaseEnvironment('win', {}), /CSC_LINK/)
  assert.throws(
    () => validateReleaseEnvironment('mac', { CSC_LINK: 'fixture', CSC_KEY_PASSWORD: 'fixture' }),
    /APPLE_ID/
  )
})
test('requires the Windows publisher and rejects blank values', () => {
  const windows = {
    CSC_LINK: 'fixture',
    CSC_KEY_PASSWORD: 'fixture',
    MEGATRON_WINDOWS_PUBLISHER: 'CN=Fixture'
  }
  assert.doesNotThrow(() => validateReleaseEnvironment('win', windows))
  assert.throws(() =>
    validateReleaseEnvironment('win', { ...windows, MEGATRON_WINDOWS_PUBLISHER: ' ' })
  )
})
test('accepts complete macOS signing and notarization settings', () => {
  assert.doesNotThrow(() =>
    validateReleaseEnvironment('mac', {
      CSC_LINK: 'fixture',
      CSC_KEY_PASSWORD: 'fixture',
      APPLE_ID: 'fixture',
      APPLE_APP_SPECIFIC_PASSWORD: 'fixture',
      APPLE_TEAM_ID: 'fixture'
    })
  )
  assert.throws(() => validateReleaseEnvironment('linux', {}), /Unsupported/)
})
