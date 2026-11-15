import { execFileSync, spawn, type ChildProcess } from 'child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readSwapResult, scheduleSwap, selfUpdateBlocker, stageUpdate } from './mac-self-update'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'megatron-self-update-test-'))
})

afterEach(() => {
  // Tests lock folders read-only; unlock them so cleanup can delete them.
  if (process.platform !== 'win32') execFileSync('/bin/chmod', ['-R', 'u+w', dir])
  rmSync(dir, { recursive: true, force: true })
})

function plist(bundleId: string, version: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>${bundleId}</string>
<key>CFBundleShortVersionString</key><string>${version}</string>
<key>CFBundleExecutable</key><string>Megatron</string>
</dict></plist>
`
}

// A minimal ad-hoc signed bundle, zipped the way electron-builder ships it.
function releaseZip(
  options: { bundleId?: string; version?: string; name?: string; tamper?: boolean } = {}
): string {
  const source = join(dir, `source-${Math.random().toString(36).slice(2)}`)
  const app = join(source, options.name ?? 'Megatron.app')
  mkdirSync(join(app, 'Contents', 'MacOS'), { recursive: true })
  execFileSync('/bin/cp', ['/usr/bin/true', join(app, 'Contents', 'MacOS', 'Megatron')])
  writeFileSync(
    join(app, 'Contents', 'Info.plist'),
    plist(options.bundleId ?? 'com.megatron.app', options.version ?? '1.2.3')
  )
  execFileSync('/usr/bin/codesign', ['--force', '--deep', '-s', '-', app], { stdio: 'ignore' })
  if (options.tamper) writeFileSync(join(app, 'Contents', 'MacOS', 'extra'), 'unsealed')
  const zip = join(dir, `${Math.random().toString(36).slice(2)}.zip`)
  execFileSync('/usr/bin/ditto', ['-c', '-k', '--keepParent', app, zip])
  return zip
}

async function eventually(condition: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition not met in time')
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

describe.runIf(process.platform === 'darwin')('selfUpdateBlocker', () => {
  it('allows a bundle this account can replace', () => {
    const bundle = join(dir, 'Megatron.app')
    mkdirSync(bundle)
    expect(selfUpdateBlocker(bundle)).toBeNull()
  })

  it('blocks a translocated copy and says to move it to Applications', () => {
    const bundle = '/private/var/folders/x/AppTranslocation/ABC-123/d/Megatron.app'
    expect(selfUpdateBlocker(bundle)).toMatch(/Applications/)
  })

  it('blocks when the folder holding the bundle is not writable', () => {
    const parent = join(dir, 'locked')
    mkdirSync(join(parent, 'Megatron.app'), { recursive: true })
    chmodSync(parent, 0o555)
    expect(selfUpdateBlocker(join(parent, 'Megatron.app'))).toContain(parent)
  })

  it('blocks when the bundle itself is not writable, as when another account installed it', () => {
    const bundle = join(dir, 'Megatron.app')
    mkdirSync(bundle)
    chmodSync(bundle, 0o555)
    expect(selfUpdateBlocker(bundle)).toContain(bundle)
  })
})

describe.runIf(process.platform === 'darwin')('stageUpdate', () => {
  it('extracts a verified update and returns the staged app', async () => {
    const staged = await stageUpdate(releaseZip(), '1.2.3', join(dir, 'staging'))
    expect(staged).toBe(join(dir, 'staging', 'Megatron.app'))
    expect(existsSync(join(staged, 'Contents', 'MacOS', 'Megatron'))).toBe(true)
  })

  it('replaces whatever an earlier attempt left in the staging folder', async () => {
    const staging = join(dir, 'staging')
    mkdirSync(join(staging, 'Megatron.app', 'leftover'), { recursive: true })
    await stageUpdate(releaseZip(), '1.2.3', staging)
    expect(existsSync(join(staging, 'Megatron.app', 'leftover'))).toBe(false)
  })

  it.each([
    ['a modified bundle', { tamper: true }, '1.2.3'],
    ['another app', { bundleId: 'com.example.other' }, '1.2.3'],
    ['a different version than announced', { version: '1.2.2' }, '1.2.3'],
    ['no Megatron.app', { name: 'Other.app' }, '1.2.3']
  ])('rejects %s and leaves nothing staged', async (_label, options, announced) => {
    const staging = join(dir, 'staging')
    await expect(stageUpdate(releaseZip(options), announced, staging)).rejects.toThrow()
    expect(existsSync(staging)).toBe(false)
  })

  it('rejects a file that is not a zip', async () => {
    const zip = join(dir, 'broken.zip')
    writeFileSync(zip, 'not a zip')
    await expect(stageUpdate(zip, '1.2.3', join(dir, 'staging'))).rejects.toThrow()
  })
})

describe.runIf(process.platform === 'darwin')('scheduleSwap', () => {
  let app: ChildProcess
  let target: string
  let staged: string
  let resultFile: string

  beforeEach(() => {
    app = spawn('/bin/sleep', ['30'])
    target = join(dir, 'Applications', 'Megatron.app')
    staged = join(dir, 'staging', 'Megatron.app')
    resultFile = join(dir, 'swap-result')
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, 'version'), 'old')
    mkdirSync(staged, { recursive: true })
    writeFileSync(join(staged, 'version'), 'new')
  })

  afterEach(() => {
    app.kill()
  })

  const installed = (): string | null =>
    existsSync(join(target, 'version')) ? readFileSync(join(target, 'version'), 'utf8') : null

  it('waits for the app to exit, then puts the new bundle in place and removes the old one', async () => {
    scheduleSwap({ pid: app.pid!, staged, target, relaunch: false, resultFile })
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(installed()).toBe('old')
    app.kill()
    await eventually(() => installed() === 'new' && !existsSync(staged))
    await eventually(() => readdirSync(join(dir, 'Applications')).length === 1)
    expect(readdirSync(join(dir, 'Applications'))).toEqual(['Megatron.app'])
    expect(existsSync(resultFile)).toBe(false)
  })

  it('takes paths as arguments, never as script text', async () => {
    const odd = join(dir, `it's "$(touch pwned)" here`, 'Megatron.app')
    mkdirSync(odd, { recursive: true })
    writeFileSync(join(odd, 'version'), 'old')
    app.kill()
    scheduleSwap({ pid: app.pid!, staged, target: odd, relaunch: false, resultFile })
    await eventually(() => readFileSync(join(odd, 'version'), 'utf8') === 'new')
    expect(existsSync(join(process.cwd(), 'pwned'))).toBe(false)
  })

  it('records a failure and keeps the old app when the folder cannot be written', async () => {
    chmodSync(join(dir, 'Applications'), 0o555)
    app.kill()
    scheduleSwap({ pid: app.pid!, staged, target, relaunch: false, resultFile })
    await eventually(() => existsSync(resultFile))
    expect(installed()).toBe('old')
    expect(readFileSync(resultFile, 'utf8').trim()).not.toBe('')
  })

  it('records a failure and creates nothing when the app moved while the update waited', async () => {
    rmSync(target, { recursive: true })
    app.kill()
    scheduleSwap({ pid: app.pid!, staged, target, relaunch: false, resultFile })
    await eventually(() => existsSync(resultFile))
    expect(existsSync(target)).toBe(false)
  })
})

describe('readSwapResult', () => {
  it('returns a recorded failure once, then nothing', () => {
    const resultFile = join(dir, 'swap-result')
    writeFileSync(resultFile, 'the swap failed\n')
    expect(readSwapResult(resultFile)).toBe('the swap failed')
    expect(readSwapResult(resultFile)).toBeNull()
  })

  it('returns nothing when no swap failed', () => {
    expect(readSwapResult(join(dir, 'swap-result'))).toBeNull()
  })
})
