import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseSignedSwitch, releaseBuildPlan } from './release-build.mjs'

test('reads the signing switch strictly so a typo cannot ship an unsigned release', () => {
  assert.equal(parseSignedSwitch('true'), true)
  assert.equal(parseSignedSwitch('false'), false)
  assert.equal(parseSignedSwitch(''), false)
  assert.equal(parseSignedSwitch(undefined), false)
  for (const value of ['TRUE', 'yes', '1', ' true'])
    assert.throws(() => parseSignedSwitch(value), /MEGATRON_SIGNED_RELEASE/)
})

test('an unsigned Mac build is ad-hoc signed, not notarized, and verified at ad-hoc level', () => {
  const plan = releaseBuildPlan('mac', false, { CSC_LINK: 'secret', PATH: '/bin' })
  assert.deepEqual(plan.args, [
    '--mac',
    '--publish',
    'never',
    '-c.mac.identity=-',
    '-c.mac.notarize=false',
    '-c.dmg.sign=false',
    '-c.mac.entitlements=build/entitlements.mac.adhoc.plist',
    '-c.mac.entitlementsInherit=build/entitlements.mac.adhoc.plist'
  ])
  assert.equal(plan.signing, 'adhoc')
  assert.equal(plan.verifyDirectory, 'dist')
})

test('an unsigned build cannot pick up signing secrets that happen to be in the environment', () => {
  const plan = releaseBuildPlan('win', false, {
    CSC_LINK: 'secret',
    CSC_KEY_PASSWORD: 'secret',
    WIN_CSC_LINK: 'secret',
    WIN_CSC_KEY_PASSWORD: 'secret',
    CSC_NAME: 'Someone',
    PATH: '/bin'
  })
  assert.deepEqual(plan.env, { PATH: '/bin', CSC_IDENTITY_AUTO_DISCOVERY: 'false' })
  assert.deepEqual(plan.args, ['--win', '--publish', 'never'])
  assert.equal(plan.signing, 'none')
  assert.equal(plan.verifyDirectory, 'dist/win-unpacked')
})

test('a signed build forces signing, keeps its credentials, and verifies at trusted level', () => {
  const environment = { CSC_LINK: 'secret', CSC_KEY_PASSWORD: 'secret', PATH: '/bin' }
  for (const [platform, flag, directory] of [
    ['mac', '--mac', 'dist'],
    ['win', '--win', 'dist/win-unpacked']
  ]) {
    const plan = releaseBuildPlan(platform, true, environment)
    assert.deepEqual(plan.args, [flag, '--publish', 'never', '-c.forceCodeSigning=true'])
    assert.deepEqual(plan.env, environment)
    assert.equal(plan.signing, 'trusted')
    assert.equal(plan.verifyDirectory, directory)
  }
})

test('rejects a platform Megatron does not ship', () => {
  assert.throws(() => releaseBuildPlan('linux', false, {}), /Unsupported/)
})
