// Manual Electron smoke check. Uses a private home/profile and a synthetic Claude executable.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { _electron as electron } from 'playwright-core'
import Database from 'better-sqlite3'
import { Worker } from 'node:worker_threads'
import { visualVerifierLaunchArgs } from './electron/electron-launch.mjs'

if (process.platform !== 'win32') throw new Error('This CLI fixture requires Windows.')
const root = mkdtempSync(join(tmpdir(), 'megatron-plugin-update-'))
const home = join(root, 'home')
const profile = join(root, 'profile')
const project = join(root, 'fixture project')
const prefix = join(root, 'trusted CLI')
const plugins = join(home, '.claude', 'plugins')
const marketplace = join(plugins, 'marketplaces', 'fixture')
const beforeInstall = join(plugins, 'cache', 'fixture', 'update-fixture', '1.0.0')
const afterInstall = join(plugins, 'cache', 'fixture', 'update-fixture', '2.0.0')
const appData = join(home, 'AppData', 'Roaming')
const localAppData = join(home, 'AppData', 'Local')
const registryPath = join(plugins, 'installed_plugins.json')
const updatedRegistryPath = join(root, 'updated-registry.json')
const commandLog = join(root, 'commands.log')
const projectSettings = join(project, '.claude', 'settings.json')
const enabledSettings = join(root, 'enabled-settings.json')
const disabledSettings = join(root, 'disabled-settings.json')
const commit = '41f619d61b999adec1a1c8deb97d1a5b6ac35bb6'
const workerOnly = process.argv.includes('--worker-only')
const saveJson = (path, value) => writeFileSync(path, JSON.stringify(value))
for (const directory of [
  home,
  profile,
  prefix,
  appData,
  localAppData,
  join(project, '.claude'),
  join(marketplace, '.claude-plugin'),
  beforeInstall,
  afterInstall
]) {
  mkdirSync(directory, { recursive: true })
}
saveJson(join(project, '.claude', 'settings.json'), {
  enabledPlugins: { 'update-fixture@fixture': true }
})
saveJson(join(marketplace, '.claude-plugin', 'marketplace.json'), {
  name: 'fixture',
  plugins: [
    { name: 'update-fixture', version: '2.0.0' },
    { name: 'hash-fixture', version: commit.slice(0, 12) },
    { name: 'release-fixture', version: commit.slice(0, 12) }
  ]
})
saveJson(join(plugins, 'known_marketplaces.json'), { fixture: { installLocation: marketplace } })
const initialRegistry = {
  version: 2,
  plugins: {
    'update-fixture@fixture': [
      { scope: 'project', projectPath: project, installPath: beforeInstall, version: '1.0.0' }
    ],
    'hash-fixture@fixture': [
      {
        scope: 'user',
        installPath: beforeInstall,
        version: commit.toUpperCase(),
        gitCommitSha: commit
      }
    ],
    'release-fixture@fixture': [
      { scope: 'user', installPath: beforeInstall, version: '1.0.0', gitCommitSha: commit }
    ]
  }
}
saveJson(registryPath, initialRegistry)
saveJson(updatedRegistryPath, {
  ...initialRegistry,
  plugins: {
    ...initialRegistry.plugins,
    'update-fixture@fixture': [
      { scope: 'project', projectPath: project, installPath: afterInstall, version: '2.0.0' }
    ]
  }
})
writeFileSync(
  join(beforeInstall, 'SKILL.md'),
  '---\nname: update-fixture\ndescription: Isolated plugin update smoke fixture.\n---\nBefore update.'
)
writeFileSync(
  join(afterInstall, 'SKILL.md'),
  '---\nname: update-fixture\ndescription: Isolated plugin update smoke fixture.\n---\nAfter update.'
)
saveJson(enabledSettings, { enabledPlugins: { 'update-fixture@fixture': true } })
saveJson(disabledSettings, { enabledPlugins: { 'update-fixture@fixture': false } })
const source = join(prefix, 'fixture.cs')
writeFileSync(
  source,
  `using System; using System.IO; using System.Threading;
class Fixture { static void Main(string[] args) {
  File.AppendAllText(Environment.GetEnvironmentVariable("MEGATRON_FIXTURE_COMMAND_LOG"), string.Join("|", args) + "\\n");
  Thread.Sleep(500);
  if (args.Length > 1 && args[1] == "update")
    File.Copy(Environment.GetEnvironmentVariable("MEGATRON_FIXTURE_UPDATED_REGISTRY"), Environment.GetEnvironmentVariable("MEGATRON_FIXTURE_REGISTRY"), true);
  if (args.Length > 1 && (args[1] == "disable" || args[1] == "enable"))
    File.Copy(Environment.GetEnvironmentVariable(args[1] == "disable" ? "MEGATRON_FIXTURE_DISABLED_SETTINGS" : "MEGATRON_FIXTURE_ENABLED_SETTINGS"), Environment.GetEnvironmentVariable("MEGATRON_FIXTURE_SETTINGS"), true);
} }`
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

const isolatedEnvironment = {
  ...process.env,
  PATH: prefix,
  USERPROFILE: home,
  HOME: home,
  APPDATA: appData,
  LOCALAPPDATA: localAppData,
  MEGATRON_FIXTURE_COMMAND_LOG: commandLog,
  MEGATRON_FIXTURE_SETTINGS: projectSettings,
  MEGATRON_FIXTURE_ENABLED_SETTINGS: enabledSettings,
  MEGATRON_FIXTURE_DISABLED_SETTINGS: disabledSettings,
  MEGATRON_FIXTURE_UPDATED_REGISTRY: updatedRegistryPath,
  MEGATRON_FIXTURE_REGISTRY: registryPath
}
async function verifyWorkerFlow() {
  // os.homedir() uses the process environment, not a worker's virtual env map.
  process.env.USERPROFILE = home
  process.env.HOME = home
  process.env.APPDATA = appData
  process.env.LOCALAPPDATA = localAppData
  const databasePath = join(profile, 'megatron.db')
  const database = new Database(databasePath)
  try {
    database.pragma('journal_mode = WAL')
    database.exec(readFileSync(resolve('src/main/db/schema.sql'), 'utf8'))
  } finally {
    database.close()
  }
  // Folder grants live in the app's preferences store, which main reads and hands to the worker.
  const grantedPaths = [project]
  async function scan(scope) {
    const worker = new Worker(resolve('out/main/scan-worker.js'), {
      workerData: { databasePath, grantedPaths, scope },
      env: isolatedEnvironment
    })
    return new Promise((resolveScan, reject) => {
      const timer = setTimeout(() => {
        void worker.terminate()
        reject(new Error('Worker smoke timed out'))
      }, 15000)
      worker.once('message', (summary) => {
        clearTimeout(timer)
        resolveScan(summary)
      })
      worker.once('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
      worker.once('exit', (code) => {
        if (code !== 0) {
          clearTimeout(timer)
          reject(new Error(`Worker exited with ${code}`))
        }
      })
    })
  }
  const initial = await scan('all')
  assert.equal(initial.outcome, 'complete', JSON.stringify(initial))
  const started = Date.now()
  for (const args of [
    ['plugin', 'marketplace', 'update', 'fixture'],
    ['plugin', 'update', 'update-fixture@fixture', '--scope', 'project', '-y']
  ]) {
    execFileSync(join(prefix, 'claude.exe'), args, {
      cwd: project,
      env: isolatedEnvironment,
      windowsHide: true
    })
  }
  const refreshed = await scan('plugins')
  assert.deepEqual(
    refreshed.sources.map((source) => source.name),
    ['scanPluginRegistry']
  )
  assert.equal(refreshed.outcome, 'complete')
  for (const verb of ['disable', 'enable']) {
    const commandStarted = Date.now()
    execFileSync(
      join(prefix, 'claude.exe'),
      ['plugin', verb, 'update-fixture@fixture', '--scope', 'project'],
      { cwd: project, env: isolatedEnvironment, windowsHide: true }
    )
    const commandMs = Date.now() - commandStarted
    const scanStarted = Date.now()
    const toggled = await scan('plugins')
    assert.deepEqual(
      toggled.sources.map((source) => source.name),
      ['scanPluginRegistry']
    )
    assert.equal(toggled.outcome, 'complete')
    const focusedMs = Date.now() - scanStarted
    const connection = new Database(databasePath, { readonly: true })
    try {
      const expected = verb === 'disable' ? 'plugin' : null
      assert.equal(
        connection
          .prepare("SELECT disabled_reason FROM plugin_registry WHERE name = 'update-fixture'")
          .get().disabled_reason,
        expected
      )
      const skills = connection
        .prepare("SELECT disabled_reason FROM skills WHERE plugin_name = 'update-fixture@fixture'")
        .all()
      assert.ok(skills.length > 0)
      assert.ok(skills.every((skill) => skill.disabled_reason === expected))
    } finally {
      connection.close()
    }
    await scan('all')
    const reopened = new Database(databasePath, { readonly: true })
    try {
      assert.equal(
        reopened
          .prepare("SELECT disabled_reason FROM plugin_registry WHERE name = 'update-fixture'")
          .get().disabled_reason,
        verb === 'disable' ? 'plugin' : null
      )
    } finally {
      reopened.close()
    }
    console.log(
      `${verb}: native CLI ${commandMs} ms; focused inventory ${focusedMs} ms; persisted state survives restart.`
    )
  }
  const restarted = await scan('all')
  assert.equal(restarted.outcome, 'complete')
  const restored = new Database(databasePath, { readonly: true })
  try {
    assert.equal(
      restored
        .prepare("SELECT installed_version FROM plugin_registry WHERE name = 'update-fixture'")
        .get().installed_version,
      '2.0.0'
    )
  } finally {
    restored.close()
  }
  console.log(
    `Real CLI fixture and bundled scan worker passed in ${Date.now() - started} ms: focused refresh excludes usage scans; restart retains installed state.`
  )
}

let app
const pageErrors = []
async function launch() {
  app = await electron.launch({
    args: visualVerifierLaunchArgs(resolve('out/main/index.js'), profile),
    env: isolatedEnvironment,
    timeout: 60_000
  })
  const window = await app.firstWindow()
  window.on('pageerror', (error) => pageErrors.push(error.message))
  await window.waitForFunction(
    async () => window.api && (await window.api.listSkills()).scanComplete
  )
  return window
}
async function openPlugin(window, name) {
  await window.getByRole('button', { name: 'Plugins', exact: true }).click()
  const back = window.getByRole('button', { name: 'Back to plugins', exact: true })
  if (await back.isVisible()) await back.click()
  await window
    .locator('tbody tr')
    .filter({ has: window.getByText(name, { exact: true }) })
    .click()
}
try {
  if (workerOnly) {
    await verifyWorkerFlow()
  } else {
    let window = await launch()
    await app.evaluate(({ dialog }, selected) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] })
    }, project)
    await window.evaluate(() => window.api.pickAndAddFolders())
    await window.evaluate(() => window.api.rescan())
    for (const name of ['hash-fixture', 'release-fixture']) {
      await openPlugin(window, name)
      await window.getByText('Up to date', { exact: true }).first().waitFor()
    }
    await openPlugin(window, 'update-fixture')
    await window.evaluate(() => {
      window.smokeProgress = []
      window.api.onPluginUpdateProgress((progress) => window.smokeProgress.push(progress.phase))
    })
    const started = Date.now()
    await window.getByRole('button', { name: 'Update', exact: true }).click()
    await window
      .getByRole('button', { name: 'Refreshing marketplace\u2026', exact: true })
      .waitFor()
    await window.getByText('update-fixture updated to 2.0.0', { exact: true }).waitFor()
    await window.getByText('Up to date', { exact: true }).first().waitFor()
    assert.deepEqual(await window.evaluate(() => window.smokeProgress), [
      'marketplace',
      'install',
      'verify'
    ])
    const installed = await window.evaluate(() =>
      window.api.getPluginDetail('update-fixture', 'fixture')
    )
    assert.equal(installed.plugin.installs[0].installed_version, '2.0.0')
    assert.equal(installed.plugin.installs[0].install_path, afterInstall)
    console.log(
      `Stayed on detail: verified result and badges updated in ${Date.now() - started} ms.`
    )
    await window.getByRole('button', { name: 'Skills', exact: true }).click()
    await window.getByRole('button', { name: 'Plugins', exact: true }).click()
    await window.getByText('Up to date', { exact: true }).first().waitFor()
    await window.getByRole('button', { name: 'Back to plugins', exact: true }).click()
    assert.match(
      await window
        .locator('tbody tr')
        .filter({ has: window.getByText('update-fixture', { exact: true }) })
        .innerText(),
      /2\.0\.0/
    )
    await openPlugin(window, 'update-fixture')
    await window.getByRole('button', { name: 'Disable', exact: true }).click()
    await window.getByText('update-fixture disabled', { exact: true }).waitFor()
    await window.getByText('Disabled', { exact: true }).first().waitFor()
    await app.close()
    app = undefined
    window = await launch()
    const grants = await window.evaluate(() => window.api.listAllowedPaths())
    assert.equal(grants.length, 1)
    assert.equal(resolve(grants[0].path).toLowerCase(), resolve(project).toLowerCase())
    await openPlugin(window, 'update-fixture')
    await window.getByText('Up to date', { exact: true }).first().waitFor()
    assert.equal(
      await window.getByRole('button', { name: 'Enable', exact: true }).isEnabled(),
      true
    )
    const reopened = await window.evaluate(() =>
      window.api.getPluginDetail('update-fixture', 'fixture')
    )
    assert.equal(reopened.plugin.installs[0].installed_version, '2.0.0')
    assert.equal(reopened.plugin.installs[0].enablement_known, true)
    assert.equal(reopened.plugin.installs[0].disabled_reason, 'plugin')
    await window.getByText('Disabled', { exact: true }).first().waitFor()
    await window.getByRole('button', { name: 'Enable', exact: true }).click()
    await window.getByRole('button', { name: 'Skills', exact: true }).click()
    await window.getByText('update-fixture enabled', { exact: true }).waitFor()
    await window.getByRole('button', { name: 'Plugins', exact: true }).click()
    await window.getByRole('button', { name: 'Disable', exact: true }).waitFor()
    const enabled = await window.evaluate(() =>
      window.api.getPluginDetail('update-fixture', 'fixture')
    )
    assert.equal(enabled.plugin.installs[0].disabled_reason, null)
    await app.close()
    app = undefined
    window = await launch()
    await openPlugin(window, 'update-fixture')
    await window.getByRole('button', { name: 'Disable', exact: true }).waitFor()
    const persistedEnabled = await window.evaluate(() =>
      window.api.getPluginDetail('update-fixture', 'fixture')
    )
    assert.equal(persistedEnabled.plugin.installs[0].disabled_reason, null)

    assert.equal(readFileSync(commandLog, 'utf8').trim().split('\n').length, 4)
    assert.deepEqual(pageErrors, [])
    console.log(
      'Electron plugin actions passed: real CLI fixture, Update, Disable, Enable, current-screen refresh, navigation during actions, saved grants, restart, and equivalent commit identifiers.'
    )
  }
} finally {
  if (app) await app.close()
  assert.equal(dirname(root), resolve(tmpdir()))
  assert.ok(basename(root).startsWith('megatron-plugin-update-'))
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}
