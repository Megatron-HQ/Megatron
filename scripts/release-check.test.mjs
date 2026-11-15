import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, realpathSync, renameSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { validateReleaseEnvironment, validateReleaseTag } from './release-check.mjs'

const RELEASE_CHECK_SCRIPT = fileURLToPath(new URL('./release-check.mjs', import.meta.url))

function releaseRepository(context) {
  const temporaryRoot = realpathSync(tmpdir())
  const directory = mkdtempSync(join(temporaryRoot, 'megatron release source '))
  context.after(() => {
    assert.equal(dirname(resolve(directory)), temporaryRoot)
    rmSync(directory, { recursive: true, force: true })
  })
  const git = (...args) =>
    execFileSync(
      'git',
      [
        '-c',
        'core.hooksPath=' + join(directory, 'empty-hooks'),
        '-c',
        'commit.gpgsign=false',
        ...args
      ],
      { cwd: directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    ).trim()
  git('init', '--initial-branch=main')
  git('config', 'user.name', 'Release fixture')
  git('config', 'user.email', 'release-fixture@example.invalid')
  git('config', 'tag.gpgsign', 'false')
  git('commit', '--allow-empty', '--message', 'Production base')
  git('update-ref', 'refs/remotes/origin/main', 'HEAD')
  git('branch', 'staging')
  git('update-ref', 'refs/remotes/origin/staging', 'HEAD')
  git('symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/staging')
  return { directory, git }
}

function checkReleaseSource(directory) {
  const result = spawnSync(process.execPath, [RELEASE_CHECK_SCRIPT, 'source'], {
    cwd: directory,
    encoding: 'utf8'
  })
  if (result.error) throw result.error
  return result
}

test('allows a detached annotated release tag on main', (context) => {
  const { directory, git } = releaseRepository(context)
  git('tag', '--annotate', 'v1.0.0', '--message', 'Production release')
  git('checkout', '--detach', 'v1.0.0')
  const result = checkReleaseSource(directory)
  assert.equal(result.status, 0, result.stderr)
})

test('allows an older release commit contained in main', (context) => {
  const { directory, git } = releaseRepository(context)
  git('tag', 'v1.0.0')
  git('commit', '--allow-empty', '--message', 'Later production change')
  git('update-ref', 'refs/remotes/origin/main', 'HEAD')
  git('checkout', '--detach', 'v1.0.0')
  const result = checkReleaseSource(directory)
  assert.equal(result.status, 0, result.stderr)
})

test('rejects a staging-only tag even when the remote default points to staging', (context) => {
  const { directory, git } = releaseRepository(context)
  git('switch', 'staging')
  git('commit', '--allow-empty', '--message', 'Unpromoted staging change')
  git('update-ref', 'refs/remotes/origin/staging', 'HEAD')
  git('tag', 'v1.0.0')
  git('checkout', '--detach', 'v1.0.0')
  const result = checkReleaseSource(directory)
  assert.equal(result.status, 1, result.stderr)
  assert.match(result.stderr, /must be contained in origin\/main/)
})

test('allows a staging commit after a merge promotes it into main', (context) => {
  const { directory, git } = releaseRepository(context)
  git('switch', 'staging')
  git('commit', '--allow-empty', '--message', 'Staging change')
  git('tag', 'v1.0.0')
  git('switch', 'main')
  git('commit', '--allow-empty', '--message', 'Production change')
  git('merge', '--no-ff', 'staging', '--message', 'Promote staging')
  git('update-ref', 'refs/remotes/origin/main', 'HEAD')
  git('checkout', '--detach', 'v1.0.0')
  const result = checkReleaseSource(directory)
  assert.equal(result.status, 0, result.stderr)
})

test('refuses release verification without the fetched origin/main ref', (context) => {
  const { directory, git } = releaseRepository(context)
  git('update-ref', '-d', 'refs/remotes/origin/main')
  const result = checkReleaseSource(directory)
  assert.equal(result.status, 1, result.stderr)
  assert.match(result.stderr, /Could not verify release source against origin\/main/)
})

test('refuses release verification outside a Git repository', (context) => {
  const { directory } = releaseRepository(context)
  renameSync(join(directory, '.git'), join(directory, 'saved-git'))
  const result = checkReleaseSource(directory)
  assert.equal(result.status, 1, result.stderr)
  assert.match(result.stderr, /Could not verify release source against origin\/main/)
})

test('refuses shallow history even when its tip matches origin/main', (context) => {
  const { directory, git } = releaseRepository(context)
  const cloneDirectory = join(directory, 'shallow clone')
  git('clone', '--depth=1', '--branch=main', pathToFileURL(directory).href, cloneDirectory)
  const result = checkReleaseSource(cloneDirectory)
  assert.equal(result.status, 1, result.stderr)
  assert.match(result.stderr, /full Git history/)
})

test('accepts only a tag that names the version being packaged', () => {
  assert.doesNotThrow(() => validateReleaseTag('v0.1.0', '0.1.0'))
  assert.doesNotThrow(() => validateReleaseTag('v0.2.0-beta.1', '0.2.0-beta.1'))
  for (const tag of ['0.1.0', 'v0.1.1', 'v0.1', 'release-0.1.0', '', undefined])
    assert.throws(() => validateReleaseTag(tag, '0.1.0'), /tag/)
})

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
