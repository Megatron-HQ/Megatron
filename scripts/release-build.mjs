// Packages a release build. Unsigned by default; MEGATRON_SIGNED_RELEASE=true switches to the
// Developer ID / Authenticode path. The switch is explicit rather than "sign if secrets exist" so
// an expired or deleted secret fails the build instead of quietly shipping it unsigned.
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateReleaseEnvironment } from './release-check.mjs'
import { verifyPackage } from './verify-package.mjs'

const AD_HOC_ENTITLEMENTS = 'build/entitlements.mac.adhoc.plist'
const SIGNING_SECRETS = [
  'CSC_LINK',
  'CSC_KEY_PASSWORD',
  'CSC_NAME',
  'WIN_CSC_LINK',
  'WIN_CSC_KEY_PASSWORD'
]

export function parseSignedSwitch(value) {
  if (value === undefined || value === '' || value === 'false') return false
  if (value === 'true') return true
  throw new Error(`MEGATRON_SIGNED_RELEASE must be "true" or "false", got ${JSON.stringify(value)}`)
}

export function releaseBuildPlan(platform, signed, environment) {
  if (!['mac', 'win'].includes(platform)) throw new Error('Unsupported release platform')
  const args = [`--${platform}`, '--publish', 'never']
  const verifyDirectory = platform === 'mac' ? 'dist' : 'dist/win-unpacked'
  if (signed)
    return {
      args: [...args, '-c.forceCodeSigning=true'],
      env: environment,
      signing: 'trusted',
      verifyDirectory
    }
  // electron-builder signs Windows builds whenever CSC_LINK is set, so an unsigned build must not
  // inherit signing secrets the CI job happens to carry.
  const env = Object.fromEntries(
    Object.entries(environment).filter(([name]) => !SIGNING_SECRETS.includes(name))
  )
  env.CSC_IDENTITY_AUTO_DISCOVERY = 'false'
  if (platform === 'win') return { args, env, signing: 'none', verifyDirectory }
  // Ad-hoc, not unsigned: arm64 macOS won't launch an unsigned binary, and electron-updater's
  // check (not install) still works. The ad-hoc entitlements add disable-library-validation,
  // without which hardened runtime rejects Electron's Apple-Team-signed frameworks.
  return {
    args: [
      ...args,
      '-c.mac.identity=-',
      '-c.mac.notarize=false',
      '-c.dmg.sign=false',
      `-c.mac.entitlements=${AD_HOC_ENTITLEMENTS}`,
      `-c.mac.entitlementsInherit=${AD_HOC_ENTITLEMENTS}`
    ],
    env,
    signing: 'adhoc',
    verifyDirectory
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const platform = process.argv[2]
  const signed = parseSignedSwitch(process.env.MEGATRON_SIGNED_RELEASE)
  if (signed) validateReleaseEnvironment(platform, process.env)
  const plan = releaseBuildPlan(platform, signed, process.env)
  console.log(`Packaging ${platform} (${plan.signing} signing)`)
  // Run the CLI through node rather than the .bin shim, which is a .cmd file on Windows.
  execFileSync(
    process.execPath,
    [
      fileURLToPath(new URL('../node_modules/electron-builder/cli.js', import.meta.url)),
      ...plan.args
    ],
    { stdio: 'inherit', env: plan.env }
  )
  await verifyPackage(resolve(plan.verifyDirectory), { signing: plan.signing })
}
