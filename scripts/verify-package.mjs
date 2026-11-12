import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import asar from '@electron/asar'
import { FuseV1Options, getCurrentFuseWire } from '@electron/fuses'

const REQUIRED_FUSES = {
  runAsNode: false,
  enableNodeOptionsEnvironmentVariable: false,
  enableNodeCliInspectArguments: false,
  enableEmbeddedAsarIntegrityValidation: true,
  onlyLoadAppFromAsar: true,
  grantFileProtocolExtraPrivileges: false
}
const FUSE_KEYS = {
  runAsNode: FuseV1Options.RunAsNode,
  enableNodeOptionsEnvironmentVariable: FuseV1Options.EnableNodeOptionsEnvironmentVariable,
  enableNodeCliInspectArguments: FuseV1Options.EnableNodeCliInspectArguments,
  enableEmbeddedAsarIntegrityValidation: FuseV1Options.EnableEmbeddedAsarIntegrityValidation,
  onlyLoadAppFromAsar: FuseV1Options.OnlyLoadAppFromAsar,
  grantFileProtocolExtraPrivileges: FuseV1Options.GrantFileProtocolExtraPrivileges
}

export function validateArchiveEntries(entries) {
  for (const entry of entries) {
    const path = entry.replaceAll('\\', '/').replace(/^\//, '')
    if (
      !/^(?:package\.json|LICENSE(?:\.txt)?|resources(?:\/icon\.(?:ico|png))?|out(?:\/(?:main|preload|renderer)(?:\/.*)?)?|node_modules(?:\/.*)?)$/.test(
        path
      )
    )
      throw new Error(`Unexpected application file: ${path}`)
    if (
      /(?:^|\/)(?:\.env(?:\.[^/]*)?|\.npmrc|\.claude|\.codex|\.agents|credentials|id_rsa|id_ed25519)(?:\/|$)/i.test(
        path
      )
    )
      throw new Error(`Sensitive file in application archive: ${path}`)
  }
  for (const required of [
    'out/main/index.js',
    'out/main/scan-worker.js',
    'out/preload/index.cjs',
    'out/renderer/index.html',
    'package.json'
  ]) {
    if (!entries.some((entry) => entry.replaceAll('\\', '/').replace(/^\//, '') === required))
      throw new Error(`Missing runtime file: ${required}`)
  }
}

const NATIVE_SQLITE = 'node_modules/better-sqlite3'
const UNPACKED_ICONS = ['resources/icon.ico', 'resources/icon.png']
const SENSITIVE_UNPACKED_FILE =
  /(?:^|\/)(?:\.env(?:\.[^/]*)?|\.npmrc|credentials|id_rsa|id_ed25519)$/

// asarUnpack exists so better-sqlite3's native build loads from disk. Anything beyond its runtime
// files and the icons is a packaging regression or dead weight shipped to every user; the target's
// own native build must be present, so an over-broad exclusion can't ship an app that can't open
// its database.
export function validateUnpackedEntries(files, { platform, arch }) {
  const nativeBuild = `${NATIVE_SQLITE}/prebuilds/${platform}-${arch}.node`
  const runtimeFiles = new Set([
    ...UNPACKED_ICONS,
    `${NATIVE_SQLITE}/package.json`,
    `${NATIVE_SQLITE}/LICENSE`,
    nativeBuild
  ])
  for (const file of files) {
    if (SENSITIVE_UNPACKED_FILE.test(file)) throw new Error(`Sensitive unpacked file: ${file}`)
    const isRuntimeScript = file.startsWith(`${NATIVE_SQLITE}/lib/`) && file.endsWith('.js')
    if (!runtimeFiles.has(file) && !isRuntimeScript)
      throw new Error(`Unexpected unpacked file: ${file}`)
  }
  if (!files.includes(nativeBuild)) throw new Error(`Missing native SQLite build: ${nativeBuild}`)
}

function listFilesRecursively(directory, prefix = '') {
  return readdirSync(directory).flatMap((name) => {
    const full = join(directory, name)
    const relative = `${prefix}${name}`
    return statSync(full).isDirectory() ? listFilesRecursively(full, `${relative}/`) : [relative]
  })
}

export function validateFuseSettings(settings) {
  for (const [name, expected] of Object.entries(REQUIRED_FUSES))
    if (settings[name] !== expected) throw new Error(`Unsafe or missing Electron fuse: ${name}`)
}

function findMacApp(directory) {
  if (directory.endsWith('.app')) return directory
  for (const name of readdirSync(directory)) {
    const candidate = join(directory, name)
    if (name.endsWith('.app')) return candidate
    if (name.startsWith('mac') && statSync(candidate).isDirectory()) {
      const app = readdirSync(candidate).find((entry) => entry.endsWith('.app'))
      if (app) return join(candidate, app)
    }
  }
  throw new Error('Packaged macOS application was not found')
}

const SIGNING_LEVELS = ['none', 'adhoc', 'trusted']

export function parseVerifyArgs(argv) {
  const directory = argv.find((arg) => !arg.startsWith('--'))
  if (!directory)
    throw new Error(
      'Usage: node scripts/verify-package.mjs <packaged directory> [--signing=none|adhoc|trusted]'
    )
  const flag = argv.find((arg) => arg.startsWith('--signing='))
  const signing = argv.includes('--require-signed')
    ? 'trusted'
    : flag
      ? flag.slice('--signing='.length)
      : 'none'
  if (!SIGNING_LEVELS.includes(signing)) throw new Error(`Unknown signing level: ${signing}`)
  return { directory, signing }
}

// Ad-hoc builds carry a real signature (arm64 macOS refuses to launch without one) but no
// Developer ID, so Gatekeeper and notarization checks only apply at the trusted level.
export function macSignatureChecks(signing, appPath) {
  if (signing === 'none') return []
  const verify = ['/usr/bin/codesign', ['--verify', '--deep', '--strict', appPath]]
  if (signing === 'adhoc') return [verify]
  return [
    verify,
    ['/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose', appPath]],
    ['/usr/bin/xcrun', ['stapler', 'validate', appPath]]
  ]
}

export async function verifyPackage(
  directory,
  { signing = 'none', platform = process.platform, arch = process.arch } = {}
) {
  const appPath = process.platform === 'darwin' ? findMacApp(directory) : resolve(directory)
  const executable =
    process.platform === 'darwin'
      ? join(appPath, 'Contents', 'MacOS', 'Megatron')
      : join(appPath, 'Megatron.exe')
  const archive =
    process.platform === 'darwin'
      ? join(appPath, 'Contents', 'Resources', 'app.asar')
      : join(appPath, 'resources', 'app.asar')
  if (!existsSync(executable) || !existsSync(archive))
    throw new Error('Packaged executable or app.asar is missing')
  const entries = asar.listPackage(archive)
  validateArchiveEntries(entries)
  const fuses = await getCurrentFuseWire(executable)
  const settings = Object.fromEntries(
    Object.entries(FUSE_KEYS).map(([name, key]) => [
      name,
      fuses[key] === 49 ? true : fuses[key] === 48 ? false : undefined
    ])
  )
  validateFuseSettings(settings)
  const unpacked = `${archive}.unpacked`
  if (!existsSync(unpacked)) throw new Error('Native dependency unpack directory is missing')
  validateUnpackedEntries(listFilesRecursively(unpacked), { platform, arch })
  if (process.platform === 'darwin') {
    for (const [command, args] of macSignatureChecks(signing, appPath))
      execFileSync(command, args, { stdio: 'inherit' })
  } else if (signing !== 'none') {
    if (process.platform === 'win32' && signing === 'trusted') {
      const powershell = join(
        process.env.SystemRoot ?? 'C:\\Windows',
        'System32',
        'WindowsPowerShell',
        'v1.0',
        'powershell.exe'
      )
      execFileSync(
        powershell,
        [
          '-NoProfile',
          '-File',
          fileURLToPath(new URL('./verify-windows-signature.ps1', import.meta.url)),
          '-Path',
          executable
        ],
        { stdio: 'inherit' }
      )
      const installers = readdirSync(resolve(directory, '..')).filter((name) =>
        name.endsWith('.exe')
      )
      if (installers.length === 0) throw new Error('Signed Windows installer is missing')
      for (const installer of installers)
        execFileSync(
          powershell,
          [
            '-NoProfile',
            '-File',
            fileURLToPath(new URL('./verify-windows-signature.ps1', import.meta.url)),
            '-Path',
            resolve(directory, '..', installer)
          ],
          { stdio: 'inherit' }
        )
    } else throw new Error(`Signing level ${signing} is not supported on ${process.platform}`)
  }
  console.log(
    `Verified ${entries.length} archive entries and all required Electron fuses; signing level: ${signing}.`
  )
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { directory, signing } = parseVerifyArgs(process.argv.slice(2))
  await verifyPackage(resolve(directory), { signing })
}
