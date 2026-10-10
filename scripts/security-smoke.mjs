import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright-core'
import Database from 'better-sqlite3'
import { visualVerifierLaunchArgs } from '../.claude/skills/visual-verify/electron-launch.mjs'

const profile = mkdtempSync(join(tmpdir(), 'megatron-security-smoke-'))
const entry = resolve('out/main/index.js')
let app
try {
  app = await electron.launch({ args: visualVerifierLaunchArgs(entry, profile), timeout: 60_000 })
  const window = await app.firstWindow()
  await window.waitForFunction(() => window.api !== undefined)
  const runtime = await app.evaluate(({ app, BrowserWindow }) => ({
    profile: app.getPath('userData'),
    preferences: BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences()
  }))
  assert.equal(resolve(runtime.profile), resolve(profile))
  assert.equal(runtime.preferences.sandbox, true)
  assert.equal(runtime.preferences.contextIsolation, true)
  assert.equal(runtime.preferences.nodeIntegration, false)
  assert.equal(window.url(), 'megatron://app/index.html')
  assert.deepEqual(
    await window.evaluate(() => ({
      node: typeof window.process,
      rawIpc: typeof window.api.ipcRenderer
    })),
    { node: 'undefined', rawIpc: 'undefined' }
  )
  const result = await window.evaluate(async () => {
    await window.api.listSkills()
    await window.api.listPlugins()
    await window.api.listAllowedPaths()
    await window.api.getUsageOverview()
    return window.api.rescan()
  })
  assert.ok(
    ['complete', 'partial'].includes(result.outcome),
    `Unexpected scan outcome: ${result.outcome}`
  )
  assert.ok(!result.sources.some((source) => source.status === 'failed'))
  assert.equal(
    await app.evaluate(async ({ net }) => (await net.fetch('megatron://app/settings.json')).status),
    404
  )
  await window.evaluate(() => {
    window.location.href = 'https://example.invalid/'
  })
  await new Promise((resolve) => setTimeout(resolve, 200))
  assert.equal(window.url(), 'megatron://app/index.html')
  const untrusted = await app.evaluate(async ({ BrowserWindow }, preload) => {
    const probe = new BrowserWindow({
      show: false,
      webPreferences: { preload, sandbox: true, contextIsolation: true, nodeIntegration: false }
    })
    try {
      await probe.loadURL('data:text/html,security-probe')
      return await probe.webContents.executeJavaScript(
        "(async () => { try { if (!window.api) return 'bridge unavailable'; await window.api.listSkills(); return 'allowed'; } catch (error) { return error.message; } })()"
      )
    } finally {
      probe.destroy()
    }
  }, resolve('out/preload/index.cjs'))
  assert.match(untrusted, /Untrusted application request/)
  console.log(
    'Electron smoke passed: sandbox, bridge, trusted-frame IPC, custom protocol, navigation and worker/SQLite scans.'
  )
} finally {
  if (app) await app.close()
  rmSync(profile, { recursive: true, force: true })
}

if (process.argv.includes('--packaged') && process.platform === 'win32') {
  const packagedProfile = mkdtempSync(join(tmpdir(), 'megatron-packaged-smoke-'))
  let output = ''
  const processHandle = spawn(
    resolve('dist/win-unpacked/Megatron.exe'),
    [`--user-data-dir=${packagedProfile}`, '--in-process-gpu'],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
  )
  processHandle.stdout.on('data', (chunk) => {
    output += chunk.toString()
  })
  processHandle.stderr.on('data', (chunk) => {
    output += chunk.toString()
  })
  let database
  try {
    const deadline = Date.now() + 60_000
    let indexed = false
    while (Date.now() < deadline) {
      if (processHandle.exitCode !== null)
        throw new Error(`Packaged app exited (${processHandle.exitCode})`)
      try {
        database = new Database(join(packagedProfile, 'megatron.db'), {
          readonly: true,
          fileMustExist: true
        })
        const count = database.prepare('SELECT COUNT(*) AS count FROM skills').get().count
        indexed = count > 0
      } catch (error) {
        if (
          !['SQLITE_CANTOPEN', 'SQLITE_BUSY'].includes(error.code) &&
          !/Cannot open database|no such table/.test(error.message)
        )
          throw error
      } finally {
        database?.close()
        database = undefined
      }
      if (indexed) break
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    assert.ok(indexed, 'Packaged worker did not populate the isolated index')
    assert.doesNotMatch(
      output,
      /Unable to load preload|ERR_FILE_NOT_FOUND|scan failed|Failed to load URL/
    )
    console.log(
      'Packaged Windows smoke passed: fused executable starts and its ASAR worker populates SQLite.'
    )
  } finally {
    processHandle.kill()
    if (processHandle.exitCode === null)
      await new Promise((resolve) => processHandle.once('exit', resolve))
    rmSync(packagedProfile, { recursive: true, force: true })
  }
}
