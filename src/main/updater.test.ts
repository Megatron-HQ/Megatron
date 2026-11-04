import Store from 'electron-store'
import { EventEmitter } from 'events'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UpdateState } from '../shared/ipc'
import type { ThemeStore } from './theme'
import { createUpdater } from './updater'

class FakeUpdater extends EventEmitter {
  autoDownload = true
  autoInstallOnAppQuit = true
  checkForUpdates = vi.fn(async () => undefined as unknown)
  quitAndInstall = vi.fn()
}

let tempDir: string
let store: ThemeStore
let updater: FakeUpdater
let broadcast: ReturnType<typeof vi.fn<(state: UpdateState) => void>>
let openExternal: ReturnType<typeof vi.fn<(url: string) => void>>
let logError: ReturnType<typeof vi.fn<(error: unknown) => void>>

function make(platform: NodeJS.Platform, isPackaged = true): ReturnType<typeof createUpdater> {
  return createUpdater({ updater, platform, isPackaged, store, broadcast, openExternal, logError })
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'megatron-updater-test-'))
  store = new Store({ name: 'preferences', cwd: tempDir })
  updater = new FakeUpdater()
  broadcast = vi.fn()
  openExternal = vi.fn()
  logError = vi.fn()
})

afterEach(() => {
  vi.useRealTimers()
  rmSync(tempDir, { recursive: true, force: true })
})

describe('unsupported builds', () => {
  it('never reaches the network from an unpackaged dev build', async () => {
    const updates = make('darwin', false)
    await updates.check()
    expect(updates.getState().status).toBe('unsupported')
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
  })

  it('treats platforms without a release as unsupported', async () => {
    const updates = make('linux')
    await updates.check()
    expect(updates.getState().status).toBe('unsupported')
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
  })
})

describe('Windows', () => {
  it('downloads in the background and installs on quit', () => {
    make('win32')
    expect(updater.autoDownload).toBe(true)
    expect(updater.autoInstallOnAppQuit).toBe(true)
  })

  it('moves from checking through downloading to ready, broadcasting each step', () => {
    const updates = make('win32')
    updater.emit('checking-for-update')
    updater.emit('update-available', { version: '0.1.1' })
    updater.emit('update-downloaded', { version: '0.1.1' })
    expect(broadcast.mock.calls.map(([state]) => state.status)).toEqual([
      'checking',
      'downloading',
      'ready'
    ])
    expect(updates.getState()).toMatchObject({ status: 'ready', version: '0.1.1' })
  })

  it('restarts into the installer only once the update is downloaded', () => {
    const updates = make('win32')
    updates.install()
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
    updater.emit('update-downloaded', { version: '0.1.1' })
    updates.install()
    expect(updater.quitAndInstall).toHaveBeenCalledWith(true, true)
  })

  it('does not re-check while a download is in flight or waiting to install', async () => {
    const updates = make('win32')
    updater.emit('update-available', { version: '0.1.1' })
    await updates.check()
    updater.emit('update-downloaded', { version: '0.1.1' })
    await updates.check()
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
    expect(updates.getState().status).toBe('ready')
  })

  it('never opens a download page', () => {
    const updates = make('win32')
    updater.emit('update-downloaded', { version: '0.1.1' })
    updates.openDownload()
    expect(openExternal).not.toHaveBeenCalled()
  })
})

describe('macOS', () => {
  it('only checks, because an ad-hoc signed app cannot install its own update', () => {
    make('darwin')
    expect(updater.autoDownload).toBe(false)
    expect(updater.autoInstallOnAppQuit).toBe(false)
  })

  it('reports an available version without downloading it', () => {
    const updates = make('darwin')
    updater.emit('update-available', { version: '0.1.1' })
    expect(updates.getState()).toMatchObject({ status: 'available', version: '0.1.1' })
  })

  it('opens the release page for the version the updater reported', () => {
    const updates = make('darwin')
    updater.emit('update-available', { version: '0.1.1' })
    updates.openDownload()
    expect(openExternal).toHaveBeenCalledWith(
      'https://github.com/Megatron-HQ/Megatron/releases/tag/v0.1.1'
    )
  })

  it('refuses to build a release URL from a malformed version', () => {
    const updates = make('darwin')
    updater.emit('update-available', { version: '../../evil' })
    updates.openDownload()
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('has nothing to open before an update is found', () => {
    make('darwin').openDownload()
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('never calls the installer', () => {
    const updates = make('darwin')
    updater.emit('update-available', { version: '0.1.1' })
    updates.install()
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
  })
})

describe('check results', () => {
  it('reports current when no update exists', () => {
    const updates = make('darwin')
    updater.emit('update-not-available', { version: '0.1.0' })
    expect(updates.getState().status).toBe('current')
  })

  it('turns an updater error into a quiet error status and logs it', () => {
    const updates = make('win32')
    const failure = new Error('net::ERR_INTERNET_DISCONNECTED')
    updater.emit('error', failure)
    expect(updates.getState().status).toBe('error')
    expect(logError).toHaveBeenCalledWith(failure)
  })

  it('logs a failure once when the updater both emits and rejects it', async () => {
    const updates = make('darwin')
    const failure = new Error('rate limited')
    updater.checkForUpdates.mockImplementationOnce(async () => {
      updater.emit('checking-for-update')
      updater.emit('error', failure)
      throw failure
    })
    await updates.check()
    expect(logError).toHaveBeenCalledTimes(1)
  })

  it('absorbs a rejected check instead of leaving an unhandled rejection', async () => {
    const updates = make('darwin')
    updater.checkForUpdates.mockRejectedValueOnce(new Error('rate limited'))
    await expect(updates.check()).resolves.toBeUndefined()
    expect(updates.getState().status).toBe('error')
  })
})

describe('schedule', () => {
  it('checks 10 seconds after start, then every 6 hours', () => {
    vi.useFakeTimers()
    make('darwin').start()
    vi.advanceTimersByTime(9_999)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(0)
    vi.advanceTimersByTime(1)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(6 * 60 * 60 * 1000)
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)
  })

  it('skips scheduled checks when automatic checking is off, but still checks on request', async () => {
    vi.useFakeTimers()
    store.set('autoUpdateCheck', false)
    const updates = make('darwin')
    updates.start()
    vi.advanceTimersByTime(7 * 60 * 60 * 1000)
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
    await updates.check()
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
  })

  it('does not schedule anything for an unsupported build', () => {
    vi.useFakeTimers()
    make('darwin', false).start()
    vi.advanceTimersByTime(7 * 60 * 60 * 1000)
    expect(updater.checkForUpdates).not.toHaveBeenCalled()
  })
})

describe('automatic checking preference', () => {
  it('defaults to on', () => {
    expect(make('darwin').getState().autoCheck).toBe(true)
  })

  it('persists a change and broadcasts it', () => {
    const updates = make('darwin')
    updates.setAutoCheck(false)
    expect(store.get('autoUpdateCheck')).toBe(false)
    expect(updates.getState().autoCheck).toBe(false)
    expect(broadcast).toHaveBeenLastCalledWith(expect.objectContaining({ autoCheck: false }))
  })
})
