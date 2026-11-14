import type { UpdateState, UpdateStatus } from '../shared/ipc'
import type { ThemeStore } from './theme'

const FIRST_CHECK_DELAY_MS = 10_000
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

// The subset of electron-updater's AppUpdater this module drives; a fake stands in for tests.
export interface UpdaterLike {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  on(event: 'checking-for-update' | 'update-not-available', listener: () => void): unknown
  on(event: 'update-available', listener: (info: { version: string }) => void): unknown
  on(
    event: 'update-downloaded',
    listener: (info: { version: string; downloadedFile: string }) => void
  ): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
  checkForUpdates(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
}

// The macOS install steps (mac-self-update.ts), bound to this app's bundle and data paths.
export interface SelfUpdate {
  blocker(): string | null
  stage(zipPath: string, version: string): Promise<string>
  scheduleSwap(staged: string, relaunch: boolean): void
  takeFailure(): string | null
}

export interface UpdaterOptions {
  updater: UpdaterLike
  platform: NodeJS.Platform
  isPackaged: boolean
  store: ThemeStore
  broadcast: (state: UpdateState) => void
  selfUpdate: SelfUpdate
  quit: () => void
  logError?: (error: unknown) => void
}

export interface Updates {
  getState(): UpdateState
  check(): Promise<void>
  install(): void
  beforeQuit(): void
  setAutoCheck(enabled: boolean): void
  start(): void
}

export function createUpdater({
  updater,
  platform,
  isPackaged,
  store,
  broadcast,
  selfUpdate,
  quit,
  logError = console.error
}: UpdaterOptions): Updates {
  const supported = isPackaged && (platform === 'win32' || platform === 'darwin')
  const mac = supported && platform === 'darwin'
  let status: UpdateStatus = supported ? 'idle' : 'unsupported'
  let version: string | null = null
  let detail: string | null = null
  // A failed swap or a rejected download stays the answer for this session, so the app doesn't
  // re-download the same update every check only to fail again.
  let sessionFailure = mac ? selfUpdate.takeFailure() : null
  let staged: string | null = null
  let swapScheduled = false

  const getState = (): UpdateState => ({
    status,
    version,
    detail,
    autoCheck: store.get('autoUpdateCheck') !== false
  })
  const set = (
    next: UpdateStatus,
    nextVersion: string | null = version,
    nextDetail: string | null = null
  ): void => {
    status = next
    version = nextVersion
    detail = nextDetail
    broadcast(getState())
  }
  const fail = (error: unknown): void => {
    logError(error)
    set('error')
  }
  const manualReason = (): string | null => sessionFailure ?? selfUpdate.blocker()

  if (sessionFailure) {
    status = 'manual'
    detail = sessionFailure
  }

  if (supported) {
    // Windows installs through NSIS on quit; macOS installs through scheduleSwap, never Squirrel.
    updater.autoDownload = true
    updater.autoInstallOnAppQuit = platform === 'win32'
    updater.on('checking-for-update', () => set('checking'))
    updater.on('update-not-available', () => set('current'))
    updater.on('update-available', (info: { version: string }) => {
      const reason = mac ? manualReason() : null
      if (reason) set('manual', info.version, reason)
      else set('downloading', info.version)
    })
    updater.on('update-downloaded', (info: { version: string; downloadedFile: string }) => {
      if (!mac) {
        set('ready', info.version)
        return
      }
      selfUpdate.stage(info.downloadedFile, info.version).then(
        (path) => {
          staged = path
          set('ready', info.version)
        },
        (error: unknown) => {
          logError(error)
          sessionFailure = error instanceof Error ? error.message : String(error)
          set('manual', info.version, sessionFailure)
        }
      )
    })
    updater.on('error', fail)
  }

  async function check(): Promise<void> {
    // Re-checking mid-download or once ready would only replay the same events and flicker the UI.
    if (!supported || ['checking', 'downloading', 'ready'].includes(status)) return
    // Decided before each check, so an install that can't replace itself never downloads.
    if (mac) updater.autoDownload = manualReason() === null
    try {
      await updater.checkForUpdates()
    } catch (error) {
      // electron-updater emits 'error' before rejecting; only report what the event missed.
      if (status !== 'error') fail(error)
    }
  }

  function scheduleSwap(relaunch: boolean): boolean {
    if (!mac || status !== 'ready' || !staged || swapScheduled) return false
    selfUpdate.scheduleSwap(staged, relaunch)
    swapScheduled = true
    return true
  }

  return {
    getState,
    check,
    install() {
      if (platform === 'win32' && status === 'ready') updater.quitAndInstall(true, true)
      else if (scheduleSwap(true)) quit()
    },
    // A plain quit with an update staged installs it too, like Windows, without reopening the app.
    beforeQuit() {
      scheduleSwap(false)
    },
    setAutoCheck(enabled) {
      store.set('autoUpdateCheck', enabled)
      broadcast(getState())
    },
    start() {
      if (!supported) return
      const scheduled = (): void => {
        if (getState().autoCheck) void check()
      }
      setTimeout(() => {
        scheduled()
        setInterval(scheduled, CHECK_INTERVAL_MS)
      }, FIRST_CHECK_DELAY_MS)
    }
  }
}
