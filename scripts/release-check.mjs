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

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  validateReleaseEnvironment(process.argv[2], process.env)
