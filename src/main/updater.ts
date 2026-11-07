import type { UpdateState, UpdateStatus } from '../shared/ipc'
import type { ThemeStore } from './theme'

const FIRST_CHECK_DELAY_MS = 10_000
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
const RELEASES_URL = 'https://github.com/Megatron-HQ/Megatron/releases/tag/v'
// The version comes from latest-mac.yml and lands in a URL path, so only plain semver passes.
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?$/

// The subset of electron-updater's AppUpdater this module drives; a fake stands in for tests.
export interface UpdaterLike {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  on(event: 'checking-for-update' | 'update-not-available', listener: () => void): unknown
  on(
    event: 'update-available' | 'update-downloaded',
    listener: (info: { version: string }) => void
  ): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
  checkForUpdates(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
}

export interface UpdaterOptions {
  updater: UpdaterLike
  platform: NodeJS.Platform
  isPackaged: boolean
  store: ThemeStore
  broadcast: (state: UpdateState) => void
  openExternal: (url: string) => void
  logError?: (error: unknown) => void
}

export interface Updates {
  getState(): UpdateState
  check(): Promise<void>
  install(): void
  setAutoCheck(enabled: boolean): void
  openDownload(): void
  start(): void
}

export function createUpdater({
  updater,
  platform,
  isPackaged,
  store,
  broadcast,
  openExternal,
  logError = console.error
}: UpdaterOptions): Updates {
  const supported = isPackaged && (platform === 'win32' || platform === 'darwin')
  let status: UpdateStatus = supported ? 'idle' : 'unsupported'
  let version: string | null = null

  const getState = (): UpdateState => ({
    status,
    version,
    autoCheck: store.get('autoUpdateCheck') !== false
  })
  const set = (next: UpdateStatus, nextVersion: string | null = version): void => {
    status = next
    version = nextVersion
    broadcast(getState())
  }
  const fail = (error: unknown): void => {
    logError(error)
    set('error')
  }

  if (supported) {
    // Squirrel.Mac refuses to install into an app without a Developer ID signature, so the Mac
    // build only reports new versions and Homebrew (or a fresh DMG) does the upgrade.
    updater.autoDownload = platform === 'win32'
    updater.autoInstallOnAppQuit = platform === 'win32'
    updater.on('checking-for-update', () => set('checking'))
    updater.on('update-not-available', () => set('current'))
    updater.on('update-available', (info: { version: string }) =>
      set(platform === 'win32' ? 'downloading' : 'available', info.version)
    )
    updater.on('update-downloaded', (info: { version: string }) => set('ready', info.version))
    updater.on('error', fail)
  }

  async function check(): Promise<void> {
    // Re-checking mid-download or once ready would only replay the same events and flicker the UI.
    if (!supported || ['checking', 'downloading', 'ready'].includes(status)) return
    try {
      await updater.checkForUpdates()
    } catch (error) {
      // electron-updater emits 'error' before rejecting; only report what the event missed.
      if (status !== 'error') fail(error)
    }
  }

  return {
    getState,
    check,
    install() {
      if (platform === 'win32' && status === 'ready') updater.quitAndInstall(true, true)
    },
    setAutoCheck(enabled) {
      store.set('autoUpdateCheck', enabled)
      broadcast(getState())
    },
    openDownload() {
      if (platform === 'darwin' && status === 'available' && version && VERSION.test(version))
        openExternal(`${RELEASES_URL}${version}`)
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
