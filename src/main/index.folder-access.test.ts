import Database from 'better-sqlite3'
import { join, resolve } from 'path'
import { tmpdir } from 'os'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { applySchema } from './db/schema'
import { addAllowedPath, listAllowedPaths } from './db/queries'
import { grantPath, isPathAllowed, resetGrantedPaths } from './permissions'
import { IPC_CHANNELS, type ScanSummary } from '../shared/ipc'

const runtime = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => unknown>(),
  contents: {
    mainFrame: { url: 'megatron://app/index.html' },
    on: vi.fn(),
    send: vi.fn(),
    setWindowOpenHandler: vi.fn()
  },
  pickFolders: vi.fn(),
  startWorker: vi.fn(),
  updatePlugin: vi.fn(),
  enablePlugin: vi.fn(),
  disablePlugin: vi.fn(),
  uninstallPlugin: vi.fn(),
  database: undefined as Database.Database | undefined
}))

vi.mock('electron', () => {
  class BrowserWindow {
    webContents = runtime.contents
    on = vi.fn()
    loadURL = vi.fn()
    static getAllWindows(): BrowserWindow[] {
      return [new BrowserWindow()]
    }
    static fromWebContents(): BrowserWindow {
      return new BrowserWindow()
    }
  }
  return {
    app: {
      commandLine: { appendSwitch: vi.fn() },
      getPath: () => '/unused',
      getName: () => 'folder-access-test',
      whenReady: () => Promise.resolve(),
      on: vi.fn()
    },
    BrowserWindow,
    ipcMain: {
      handle: (channel: string, handler: (...args: unknown[]) => unknown) =>
        runtime.handlers.set(channel, handler),
      on: vi.fn()
    },
    dialog: { showOpenDialog: runtime.pickFolders },
    session: {
      defaultSession: {
        setPermissionCheckHandler: vi.fn(),
        setPermissionRequestHandler: vi.fn(),
        setDevicePermissionHandler: vi.fn()
      }
    },
    protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() },
    net: {},
    shell: {}
  }
})
vi.mock('electron-store', () => ({
  default: class {
    values = new Map()
    get(key: string): unknown {
      return this.values.get(key)
    }
    set(key: string, value: unknown): void {
      this.values.set(key, value)
    }
  }
}))
vi.mock('@electron-toolkit/utils', () => ({
  electronApp: { setAppUserModelId: vi.fn() },
  optimizer: { watchWindowShortcuts: vi.fn() },
  is: { dev: false }
}))
vi.mock('../../resources/icon.png?asset', () => ({ default: 'icon.png' }))
vi.mock('../../resources/icon.ico?asset', () => ({ default: 'icon.ico' }))
vi.mock('./db', () => ({ getDb: () => runtime.database }))
vi.mock('./plugin-actions', async (original) => ({
  ...(await original<typeof import('./plugin-actions')>()),
  updatePlugin: runtime.updatePlugin,
  enablePlugin: runtime.enablePlugin,
  disablePlugin: runtime.disablePlugin,
  uninstallPlugin: runtime.uninstallPlugin
}))

vi.mock('./permissions', async (original) => ({
  ...(await original<typeof import('./permissions')>()),
  securePrivateDataDirectory: vi.fn()
}))
vi.mock('./ingest/scan-all', async (original) => ({
  ...(await original<typeof import('./ingest/scan-all')>()),
  startScanWorker: runtime.startWorker
}))

const summary: ScanSummary = {
  outcome: 'complete',
  completedAt: '2026-10-20T12:00:00.000Z',
  sources: []
}
const folder = resolve(tmpdir(), 'megatron-folder-access-test')
const event = { sender: runtime.contents, senderFrame: runtime.contents.mainFrame }

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let complete!: (value: T) => void
  const promise = new Promise<T>((resolve) => (complete = resolve))
  return { promise, resolve: complete }
}

async function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
  return runtime.handlers.get(channel)!(event, ...args)
}

beforeAll(async () => {
  runtime.database = new Database(':memory:')
  applySchema(runtime.database)
  runtime.startWorker.mockImplementation(() => ({
    result: Promise.resolve(summary),
    cancel: async () => undefined
  }))
  await import('./index')
  await new Promise((resolve) => setImmediate(resolve))
})

beforeEach(() => {
  runtime.database!.prepare('DELETE FROM allowed_paths').run()
  resetGrantedPaths()
  runtime.contents.send.mockClear()
  runtime.pickFolders.mockReset()
})

afterAll(() => runtime.database?.close())

describe('folder access IPC', () => {
  it('restarts an interrupted scan even if saving the folder grant fails', async () => {
    let interrupt!: (error: Error) => void
    const interrupted = new Promise<ScanSummary>((_resolve, reject) => (interrupt = reject))
    const replacement = deferred<ScanSummary>()
    runtime.startWorker
      .mockReturnValueOnce({
        result: interrupted,
        cancel: async () => interrupt(new Error('Scan cancelled after folder permissions changed'))
      })
      .mockReturnValueOnce({ result: replacement.promise, cancel: async () => undefined })
    addAllowedPath(runtime.database!, grantPath(folder))
    runtime.database!.exec(`
      CREATE TRIGGER fail_grant BEFORE INSERT ON allowed_paths
      BEGIN SELECT RAISE(ABORT, 'Fixture: grant could not be saved'); END;
    `)
    runtime.pickFolders.mockResolvedValueOnce({ canceled: false, filePaths: [folder] })
    let completed = false
    const scanning = invoke(IPC_CHANNELS.rescan).then(() => (completed = true))
    try {
      await expect(invoke(IPC_CHANNELS.pickAndAddFolders)).rejects.toThrow(
        'grant could not be saved'
      )
      replacement.resolve(summary)
      await vi.waitFor(() => expect(completed).toBe(true), { timeout: 500 })
      expect(listAllowedPaths(runtime.database!)).toHaveLength(1)
    } finally {
      runtime.database!.exec('DROP TRIGGER fail_grant')
      replacement.resolve(summary)
      await invoke(IPC_CHANNELS.rescan)
      await scanning
    }
  })

  it.each(['add', 'revoke'] as const)(
    'does not publish a failure when %s replaces an active scan',
    async (action) => {
      let interrupt!: (error: Error) => void
      const interrupted = new Promise<ScanSummary>((_resolve, reject) => (interrupt = reject))
      const replacement = deferred<ScanSummary>()
      const reportError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      runtime.startWorker
        .mockReturnValueOnce({
          result: interrupted,
          cancel: async () =>
            interrupt(new Error('Scan cancelled after folder permissions changed'))
        })
        .mockReturnValueOnce({ result: replacement.promise, cancel: async () => undefined })
      addAllowedPath(runtime.database!, grantPath(folder))
      runtime.pickFolders.mockResolvedValueOnce({ canceled: false, filePaths: [folder] })
      const scanning = invoke(IPC_CHANNELS.rescan)
      try {
        await invoke(
          action === 'add' ? IPC_CHANNELS.pickAndAddFolders : IPC_CHANNELS.revokeAllowedPath,
          ...(action === 'revoke' ? [folder] : [])
        )
        expect(reportError).not.toHaveBeenCalled()
        expect(
          runtime.contents.send.mock.calls.filter(
            ([channel]) => channel === IPC_CHANNELS.scanComplete
          )
        ).toEqual([])
        expect((await invoke(IPC_CHANNELS.listSkills)) as { scanActivity: unknown }).toMatchObject({
          scanActivity: expect.objectContaining({ id: expect.any(Number) })
        })
      } finally {
        replacement.resolve(summary)
        await scanning
        reportError.mockRestore()
      }
      expect(
        runtime.contents.send.mock.calls.filter(
          ([channel]) => channel === IPC_CHANNELS.scanComplete
        )
      ).toEqual([[IPC_CHANNELS.scanComplete, expect.objectContaining({ summary })]])
    }
  )

  it('returns a persisted revocation before the replacement scan completes', async () => {
    const scan = deferred<ScanSummary>()
    runtime.startWorker.mockReturnValueOnce({ result: scan.promise, cancel: async () => undefined })
    addAllowedPath(runtime.database!, grantPath(folder))
    let result: unknown
    const operation = invoke(IPC_CHANNELS.revokeAllowedPath, folder).then(
      (value) => (result = value)
    )
    try {
      await vi.waitFor(() => expect(result).toEqual([]), { timeout: 500 })
      expect(isPathAllowed(join(folder, 'SKILL.md'))).toBe(false)
      expect(listAllowedPaths(runtime.database!)).toEqual([])
      expect(
        runtime.contents.send.mock.calls.some(([channel]) => channel === 'scan:complete')
      ).toBe(false)
    } finally {
      scan.resolve(summary)
      await operation
    }
    await vi.waitFor(() =>
      expect(
        runtime.contents.send.mock.calls.some(([channel]) => channel === 'scan:complete')
      ).toBe(true)
    )
  })

  it('returns newly granted folders before their inventory scan completes', async () => {
    const scan = deferred<ScanSummary>()
    runtime.startWorker.mockReturnValueOnce({ result: scan.promise, cancel: async () => undefined })
    runtime.pickFolders.mockResolvedValueOnce({ canceled: false, filePaths: [folder] })
    let result: unknown
    const operation = invoke(IPC_CHANNELS.pickAndAddFolders).then((value) => (result = value))
    try {
      await vi.waitFor(
        () => expect(result).toEqual([{ path: folder, granted_at: expect.any(String) }]),
        {
          timeout: 500
        }
      )
      expect(isPathAllowed(join(folder, 'SKILL.md'))).toBe(true)
    } finally {
      scan.resolve(summary)
      await operation
    }
  })

  it('stops the old worker before revoking its access', async () => {
    const oldScan = deferred<ScanSummary>()
    const stopped = deferred<void>()
    runtime.startWorker.mockReturnValueOnce({
      result: oldScan.promise,
      cancel: async () => {
        await stopped.promise
        oldScan.resolve(summary)
      }
    })
    addAllowedPath(runtime.database!, grantPath(folder))
    const scanning = invoke(IPC_CHANNELS.rescan)
    const revoking = invoke(IPC_CHANNELS.revokeAllowedPath, folder)
    await Promise.resolve()
    expect(isPathAllowed(folder)).toBe(true)
    expect(listAllowedPaths(runtime.database!)).toHaveLength(1)
    stopped.resolve()
    await Promise.all([scanning, revoking])
    expect(isPathAllowed(folder)).toBe(false)
    expect(listAllowedPaths(runtime.database!)).toEqual([])
  })

  it('keeps access intact if the old worker cannot be stopped', async () => {
    const scan = deferred<ScanSummary>()
    runtime.startWorker.mockReturnValueOnce({
      result: scan.promise,
      cancel: async () => {
        throw new Error('Worker termination failed')
      }
    })
    addAllowedPath(runtime.database!, grantPath(folder))
    const scanning = invoke(IPC_CHANNELS.rescan)
    try {
      await expect(invoke(IPC_CHANNELS.revokeAllowedPath, folder)).rejects.toThrow(
        'Worker termination failed'
      )
      expect(isPathAllowed(folder)).toBe(true)
      expect(listAllowedPaths(runtime.database!)).toHaveLength(1)
    } finally {
      scan.resolve(summary)
      await scanning
    }
  })

  it('reports a failed background scan without undoing the persisted revocation', async () => {
    let fail!: (error: Error) => void
    const failedScan = new Promise<ScanSummary>((_resolve, reject) => (fail = reject))
    const reportError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    runtime.startWorker.mockReturnValueOnce({ result: failedScan, cancel: async () => undefined })
    addAllowedPath(runtime.database!, grantPath(folder))
    const operation = invoke(IPC_CHANNELS.revokeAllowedPath, folder)
    try {
      await vi.waitFor(() => expect(listAllowedPaths(runtime.database!)).toEqual([]))
      fail(new Error('Unreadable inventory'))
      await expect(operation).resolves.toEqual([])
      await vi.waitFor(() =>
        expect(runtime.contents.send.mock.calls).toContainEqual([
          IPC_CHANNELS.scanComplete,
          expect.objectContaining({ summary: expect.objectContaining({ outcome: 'failed' }) })
        ])
      )
      expect(isPathAllowed(folder)).toBe(false)
    } finally {
      reportError.mockRestore()
    }
  })
})

describe('plugin update IPC', () => {
  const input = { name: 'demo', marketplace: 'market', scope: 'user', projectPath: null }
  function seedInstall(): void {
    runtime.database!.prepare('DELETE FROM plugin_registry').run()
    runtime
      .database!.prepare(
        `INSERT INTO plugin_registry
      (name, marketplace, scope, project_path, install_path, installed_version, available_version, last_scanned_at)
      VALUES ('demo', 'market', 'user', '', '/fixture/plugin', '1.0.0', '2.0.0', '2026-10-20')`
      )
      .run()
    runtime.updatePlugin.mockImplementation(async () => {
      runtime.database!.prepare("UPDATE plugin_registry SET installed_version = '2.0.0'").run()
      return { ok: true }
    })
  }

  it('returns the refreshed plugin snapshot and requests only plugin work before completion', async () => {
    seedInstall()
    const scopes: string[] = []
    runtime.startWorker.mockImplementation((_entry, input) => {
      scopes.push(input.scope)
      return {
        result: Promise.resolve({
          ...summary,
          sources: [{ name: 'scanPluginRegistry', status: 'complete' }]
        }),
        cancel: async () => undefined
      }
    })
    const result = await invoke(IPC_CHANNELS.updatePlugin, input)
    expect(result).toMatchObject({ ok: true, detail: { plugin: { installed_version: '2.0.0' } } })
    expect(scopes[0]).toBe('plugins')
    expect(runtime.contents.send.mock.calls).toContainEqual([
      IPC_CHANNELS.pluginUpdateProgress,
      { input, phase: 'verify' }
    ])
    await new Promise((resolve) => setImmediate(resolve))
  })

  it('accepts a refreshed target when only unrelated projects need folder access', async () => {
    seedInstall()
    runtime.startWorker.mockImplementation(() => ({
      result: Promise.resolve({
        ...summary,
        outcome: 'partial',
        sources: [
          {
            name: 'scanPluginRegistry',
            status: 'partial',
            issues: [{ code: 'permission_required', path: '/unrelated/project' }]
          }
        ]
      }),
      cancel: async () => undefined
    }))
    const result = await invoke(IPC_CHANNELS.updatePlugin, input)
    expect(result).toMatchObject({ ok: true, detail: { plugin: { installed_version: '2.0.0' } } })
    await new Promise((resolve) => setImmediate(resolve))
  })

  it('blocks a duplicate update while the first command is awaiting verification', async () => {
    seedInstall()
    const focusedScan = deferred<ScanSummary>()
    runtime.startWorker.mockImplementation((_entry, input) => ({
      result: input.scope === 'plugins' ? focusedScan.promise : Promise.resolve(summary),
      cancel: async () => undefined
    }))
    const first = invoke(IPC_CHANNELS.updatePlugin, input)
    await new Promise((resolve) => setImmediate(resolve))
    try {
      await expect(invoke(IPC_CHANNELS.updatePlugin, input)).resolves.toMatchObject({
        ok: false,
        stderr: expect.stringMatching(/already running/)
      })
    } finally {
      focusedScan.resolve({
        ...summary,
        sources: [{ name: 'scanPluginRegistry', status: 'complete' }]
      })
      await first
      await new Promise((resolve) => setImmediate(resolve))
    }
  })

  it('reports verification failure separately after the CLI has succeeded', async () => {
    seedInstall()
    runtime.startWorker.mockImplementation(() => ({
      result: Promise.resolve({
        ...summary,
        outcome: 'failed',
        sources: [{ name: 'scanPluginRegistry', status: 'failed' }]
      }),
      cancel: async () => undefined
    }))
    const result = await invoke(IPC_CHANNELS.updatePlugin, input)
    expect(result).toMatchObject({
      ok: true,
      verificationError: expect.stringMatching(/command completed.*inventory/i)
    })
    await new Promise((resolve) => setImmediate(resolve))
  })
})

describe('plugin toggle IPC', () => {
  const input = { name: 'demo', marketplace: 'market', scope: 'user', projectPath: null }

  it.each(['enable', 'disable'] as const)(
    '%s returns verified state while unrelated background work is unfinished',
    async (verb) => {
      runtime.database!.prepare('DELETE FROM plugin_registry').run()
      runtime
        .database!.prepare(
          `INSERT INTO plugin_registry
      (name, marketplace, scope, project_path, install_path, installed_version, last_scanned_at, disabled_reason)
      VALUES ('demo', 'market', 'user', '', '/fixture/plugin', '1.0.0', '2026-10-20', ?)`
        )
        .run(verb === 'enable' ? 'plugin' : null)
      runtime[`${verb}Plugin`].mockImplementation(async () => {
        runtime
          .database!.prepare('UPDATE plugin_registry SET disabled_reason = ?')
          .run(verb === 'disable' ? 'plugin' : null)
        return { ok: true }
      })
      const background = deferred<ScanSummary>()
      const focused: ScanSummary = {
        ...summary,
        sources: [{ name: 'scanPluginRegistry', status: 'complete' }]
      }
      const scopes: string[] = []
      runtime.startWorker.mockImplementation((_entry, input) => {
        scopes.push(input.scope)
        return {
          result: input.scope === 'plugins' ? Promise.resolve(focused) : background.promise,
          cancel: async () => undefined
        }
      })
      let completed = false
      const operation = invoke(
        verb === 'enable' ? IPC_CHANNELS.enablePlugin : IPC_CHANNELS.disablePlugin,
        input
      ).then((result) => {
        completed = true
        return result
      })
      await new Promise((resolve) => setImmediate(resolve))
      try {
        expect(completed).toBe(true)
        expect(await operation).toMatchObject({
          ok: true,
          detail: {
            plugin: { installs: [{ disabled_reason: verb === 'disable' ? 'plugin' : null }] }
          }
        })
        expect(scopes[0]).toBe('plugins')
      } finally {
        background.resolve(focused)
        await operation
        await new Promise((resolve) => setImmediate(resolve))
      }
    }
  )
})
