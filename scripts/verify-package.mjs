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

export async function verifyPackage(directory, { requireSigned = false } = {}) {
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
  function inspectUnpacked(path, prefix = '') {
    for (const name of readdirSync(path)) {
      const relative = `${prefix}${name}`
      const full = join(path, name)
      if (
        !relative.startsWith('node_modules/') &&
        relative !== 'node_modules' &&
        !['resources', 'resources/icon.ico', 'resources/icon.png'].includes(relative)
      )
        throw new Error(`Unexpected unpacked file: ${relative}`)
      if (statSync(full).isDirectory()) inspectUnpacked(full, `${relative}/`)
      else if (
        /(?:^|\/)(?:\.env(?:\.[^/]*)?|\.npmrc|credentials|id_rsa|id_ed25519)$/.test(relative)
      )
        throw new Error(`Sensitive unpacked file: ${relative}`)
    }
  }
  inspectUnpacked(unpacked)
  if (requireSigned) {
    if (process.platform === 'darwin') {
      execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', appPath], {
        stdio: 'inherit'
      })
      execFileSync('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose', appPath], {
        stdio: 'inherit'
      })
      execFileSync('/usr/bin/xcrun', ['stapler', 'validate', appPath], { stdio: 'inherit' })
    } else if (process.platform === 'win32') {
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
    } else throw new Error('Unsupported release platform')
  }
  console.log(
    `Verified ${entries.length} archive entries and all required Electron fuses${requireSigned ? '; signatures verified' : '; unsigned local artifact'}.`
  )
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const directory = process.argv[2]
  if (!directory)
    throw new Error(
      'Usage: node scripts/verify-package.mjs <packaged directory> [--require-signed]'
    )
  await verifyPackage(resolve(directory), {
    requireSigned: process.argv.includes('--require-signed')
  })
}
