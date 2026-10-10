import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { _electron as electron } from 'playwright-core'
import { visualVerifierLaunchArgs } from '../.claude/skills/visual-verify/electron-launch.mjs'

if (process.platform !== 'win32') {
  console.log('Windows CLI IPC fixture skipped on this platform.')
} else {
  const root = mkdtempSync(join(tmpdir(), 'megatron-cli-ipc-'))
  const home = join(root, 'isolated-home')
  const profile = join(root, 'profile')
  const appData = join(home, 'AppData', 'Roaming')
  const localAppData = join(home, 'AppData', 'Local')
  const prefix = join(root, 'trusted prefix')
  const project = join(root, 'fixture project')
  for (const directory of [home, profile, appData, localAppData, prefix, join(project, '.claude')])
    mkdirSync(directory, { recursive: true })
  const input = {
    name: 'security-fixture',
    marketplace: 'security-fixture',
    scope: 'project',
    projectPath: project
  }
  writeFileSync(
    join(project, '.claude', 'settings.json'),
    JSON.stringify({ enabledPlugins: { 'security-fixture@security-fixture': false } })
  )
  writeFileSync(
    join(project, 'claude.cmd'),
    '@echo off\r\n>"%~dp0hostile-marker.txt" echo PROJECT_EXECUTED\r\n'
  )
  const source = join(prefix, 'fixture.cs')
  writeFileSync(
    source,
    'using System; using System.IO; class Fixture { static void Main(string[] args) { File.WriteAllText("trusted-marker.txt", string.Join("|", args)); } }'
  )
  execFileSync(
    join(
      process.env.SystemRoot ?? 'C:\\Windows',
      'Microsoft.NET',
      'Framework64',
      'v4.0.30319',
      'csc.exe'
    ),
    ['/nologo', '/target:exe', `/out:${join(prefix, 'claude.exe')}`, source],
    { windowsHide: true }
  )
  let app
  try {
    app = await electron.launch({
      args: visualVerifierLaunchArgs(resolve('out/main/index.js'), profile),
      env: {
        ...process.env,
        PATH: prefix,
        USERPROFILE: home,
        HOME: home,
        APPDATA: appData,
        LOCALAPPDATA: localAppData
      },
      timeout: 60_000
    })
    assert.equal(
      resolve(await app.evaluate(({ app }) => app.getPath('userData'))),
      resolve(profile)
    )
    const window = await app.firstWindow()
    await window.waitForFunction(() => window.api !== undefined)
    await app.evaluate(({ dialog }, selected) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] })
    }, project)
    await window.evaluate(() => window.api.pickAndAddFolders())
    const database = new Database(join(profile, 'megatron.db'))
    try {
      database
        .prepare(
          `INSERT INTO plugin_registry (name,marketplace,installed_version,scope,install_path,last_scanned_at,project_path)
        VALUES (@name,@marketplace,'fixture',@scope,@install,'2026-10-10T00:00:00.000Z',@projectPath)`
        )
        .run({ ...input, install: join(prefix, 'fixture-plugin') })
    } finally {
      database.close()
    }
    const result = await window.evaluate((value) => window.api.enablePlugin(value), input)
    assert.equal(result.ok, true)
    assert.equal(existsSync(join(project, 'hostile-marker.txt')), false)
    assert.equal(
      readFileSync(join(project, 'trusted-marker.txt'), 'utf8'),
      'plugin|enable|security-fixture@security-fixture|--scope|project'
    )
    console.log(
      'Full Electron plugin IPC passed: indexed install authorization, granted project, trusted executable and no project-script execution. Real Claude was unreachable through the fixture PATH and home.'
    )
  } finally {
    if (app) await app.close()
    rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  }
}
