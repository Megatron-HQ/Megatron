import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

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
  } else validateReleaseEnvironment(process.argv[2], process.env)
}
