import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PRODUCTION_RELEASE_REF = 'refs/remotes/origin/main'
const UNVERIFIABLE_RELEASE_SOURCE =
  'Could not verify release source against origin/main. Fetch complete Git history before releasing.'

function validateReleaseSource() {
  const gitOptions = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
  let shallowHistory
  try {
    shallowHistory = execFileSync(
      'git',
      ['rev-parse', '--is-shallow-repository'],
      gitOptions
    ).trim()
  } catch (cause) {
    throw new Error(UNVERIFIABLE_RELEASE_SOURCE, { cause })
  }
  if (shallowHistory !== 'false')
    throw new Error('Release source verification requires full Git history (fetch-depth: 0).')

  try {
    execFileSync('git', ['merge-base', '--is-ancestor', 'HEAD', PRODUCTION_RELEASE_REF], gitOptions)
  } catch (cause) {
    throw new Error(
      cause.status === 1
        ? 'Release commit must be contained in origin/main. Promote changes to main before tagging.'
        : UNVERIFIABLE_RELEASE_SOURCE,
      { cause }
    )
  }
}

export function validateReleaseEnvironment(platform, environment) {
  if (!['mac', 'win'].includes(platform)) throw new Error('Unsupported release platform')
  const required = [
    'CSC_LINK',
    'CSC_KEY_PASSWORD',
    ...(platform === 'mac'
      ? ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID']
      : ['MEGATRON_WINDOWS_PUBLISHER'])
  ]
  for (const name of required)
    if (typeof environment[name] !== 'string' || environment[name].trim() === '')
      throw new Error(`Missing release setting: ${name}`)
}

// latest*.yml carries package.json's version, so a tag that disagrees would publish an update
// feed pointing at a release with a different name.
export function validateReleaseTag(tag, version) {
  if (tag !== `v${version}`)
    throw new Error(`Release tag ${JSON.stringify(tag)} does not match package.json v${version}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === 'tag') {
    const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)))
    validateReleaseTag(process.argv[3], version)
  } else if (process.argv[2] === 'source') validateReleaseSource()
  else validateReleaseEnvironment(process.argv[2], process.env)
}
