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
})

afterAll(() => runtime.database?.close())

describe('folder access IPC', () => {
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
