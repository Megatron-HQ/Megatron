import { app, shell, BrowserWindow, dialog, ipcMain, net, protocol, session } from 'electron'
import { basename, join } from 'path'
import { homedir } from 'os'
import { pathToFileURL } from 'url'
import {
  canManagePluginInstall,
  deniedPluginActionMessage,
  isTrustedIpcSender,
  isTrustedRendererUrl,
  resolveBundledAsset,
  validateIpcArguments
} from './ipc-security'
// Bundled at build time so it always matches package.json — app.getVersion() returns the
// Electron executable's version under `electron-vite dev` (the app has no package.json on
// disk there), not this app's.
import { version as appVersion } from '../../package.json'
import Store from 'electron-store'
// electron-updater is CommonJS; its named exports are lazy getters, so take the default.
import electronUpdater from 'electron-updater'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
// The .ico, not the PNG, so Windows can pick the hand-tuned no-sparkle art at 16/24 px.
import windowsIcon from '../../resources/icon.ico?asset'
import { getDb, getUsageArchive } from './db'
import {
  getUsageOverviewData,
  getProjectUsageCalendar,
  getProjectUsageDay,
  readUsageProjectLocations,
  usageProjectCatalog,
  linkUsageProjects,
  unlinkUsageProject
} from './usage-projects'
import type { UsageProjectLocation } from '../shared/usage-projects'
import { createScanSession, type ScanUrgency } from './scan-session'
import { disableChromiumHttpCache } from './chromium-cache'
import { changeAllowedPaths, listAllowedPaths, normalizeAllowedPaths } from './folder-grants'
import { createUpdater, type Updates } from './updater'
import {
  deleteSkillsForProjectRoot,
  getContextBudget,
  getLintFindingsForSkill,
  getPluginDetail,
  getSkillById,
  getSkillInvocationLog,
  getSkillInvocationSlice,
  getSkillUsageDetail,
  listPlugins,
  listSkills
} from './db/queries'
import {
  canonicalGrantPath,
  getGrantedPaths,
  isPathAllowed,
  grantPath,
  restoreGrantedPath,
  revokePath,
  securePrivateDataDirectory
} from './permissions'
import {
  markOnboardingDone,
  resolveInitialSection,
  resolveInitialTheme,
  resolveOnboarding,
  setStoredSection,
  setStoredTheme,
  type ThemeStore
} from './theme'
import { suggestGrantStart } from '../shared/grant-suggestions'
import {
  createScanController,
  ScanWorkerError,
  startScanWorker,
  type ScanScope
} from './ingest/scan-all'
import { createInventoryWatcher } from './inventory-watcher'
import { findNewestRecordedRequest } from './ingest/recorded-request'
import { measureContextBaseline } from './context-usage'
import { USAGE_ARCHIVE_FILENAME } from './db/usage-archive'
import { findStaleSkillIds, usageDataTrusted } from './db/stale-skills'
import { sanitizeProjectFolders } from './ingest/project-discovery'
import { readSkillFiles, readSkillMd } from './skill-files'
import { openSafeExternal } from './shell'
import { disablePlugin, enablePlugin, uninstallPlugin, updatePlugin } from './plugin-actions'
import { createPluginActionService } from './plugin-action-service'
import {
  GRANT_GUIDANCE,
  IPC_CHANNELS,
  INVOCATION_PAGE_SIZE,
  type AppSection,
  type GrantChangeResult,
  type OpenSkillMetaResult,
  type OpenSkillResult,
  type PluginActionInput,
  type SkillInvocationEntry,
  type SkillInvocationRecord,
  type SkillInvocationSliceInput,
  type ScanActivity,
  type ScanFinished,
  type ScanSourceSummary,
  type ScanSummary,
  type SkillsListResult,
  type ThemePreference
} from '../shared/ipc'

// Megatron's renderer is bundled locally, so an HTTP cache adds corruption risk without a
// production benefit. This must run before Electron creates its default session.
disableChromiumHttpCache(app.commandLine)
protocol.registerSchemesAsPrivileged([
  { scheme: 'megatron', privileges: { standard: true, secure: true, supportFetchAPI: true } }
])
const APP_URL = 'megatron://app/index.html'
const MIN_FOCUS_SCAN_INTERVAL_MS = 10_000
const APP_CONTENT_SECURITY_POLICY =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'; worker-src 'none'"

securePrivateDataDirectory(app.getPath('userData'), join(app.getPath('appData'), app.getName()))
const themeStore: ThemeStore = new Store({ name: 'preferences' })

function usageProjectLocations(): UsageProjectLocation[] {
  const saved = themeStore.get('usageProjects')
  const locations = readUsageProjectLocations(
    getDb(),
    getUsageArchive(),
    saved,
    sanitizeProjectFolders(themeStore.get('projectFolders')).filter((project) =>
      isPathAllowed(project.path)
    )
  )
  if (JSON.stringify(locations) !== JSON.stringify(saved))
    themeStore.set('usageProjects', locations)
  return locations
}
let scanComplete = false
let usageComplete = false
// Empty until this launch's first usage scan reports, so staleness never trusts an index left
// over from a previous launch. Inventory-only rescans skip these sources, so the last status
// carries over and the stale flags don't flicker on every watcher refresh.
const usageSourceStatus = new Map<string, ScanSourceSummary['status']>()
let scanSummary: ScanSummary | undefined
const scanSession = createScanSession()
let lastScanFinished: ScanFinished | null = null
let updates: Updates | null = null
const trustedWindows = new Map<Electron.WebContents, string>()
let inventoryWatcher: ReturnType<typeof createInventoryWatcher> | undefined

function assertRequest(
  event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent,
  channel: string,
  args: unknown[]
): void {
  const trusted = trustedWindows.get(event.sender)
  if (!trusted || !isTrustedIpcSender(event, event.sender, trusted))
    throw new Error('Untrusted application request')
  validateIpcArguments(channel, args)
  if (
    [
      IPC_CHANNELS.enablePlugin,
      IPC_CHANNELS.disablePlugin,
      IPC_CHANNELS.updatePlugin,
      IPC_CHANNELS.uninstallPlugin
    ].includes(channel as never)
  ) {
    const input = args[0] as PluginActionInput
    const plugin = getPluginDetail(getDb(), input.name, input.marketplace)?.plugin ?? null
    if (!canManagePluginInstall(input, plugin)) {
      throw new Error(deniedPluginActionMessage(input, plugin))
    }
  }
}

const secureIpc = {
  handle(channel: string, listener: Parameters<typeof ipcMain.handle>[1]): void {
    ipcMain.handle(channel, (event, ...args) => {
      assertRequest(event, channel, args)
      return listener(event, ...args)
    })
  },
  on(channel: string, listener: Parameters<typeof ipcMain.on>[1]): void {
    ipcMain.on(channel, (event, ...args) => {
      try {
        assertRequest(event, channel, args)
        listener(event, ...args)
      } catch {
        event.returnValue = null
      }
    })
  }
}

function notifyScanStarted(activity: ScanActivity): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(IPC_CHANNELS.scanStarted, activity)
  }
}

function notifyScanFinished(finished: ScanFinished): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(IPC_CHANNELS.scanComplete, finished)
  }
}

const scans = createScanController((scope) =>
  startScanWorker(
    join(import.meta.dirname, 'scan-worker.js'),
    {
      scope,
      databasePath: getDb().name,
      archivePath: join(app.getPath('userData'), USAGE_ARCHIVE_FILENAME),
      grantedPaths: getGrantedPaths(),
      previousProjects: sanitizeProjectFolders(themeStore.get('projectFolders'))
    },
    undefined,
    (progress) => {
      if (progress.type !== 'source-complete') return
      if (progress.source.name === 'archivePrompts') usageComplete = true
      if (progress.source.name === 'scanTranscripts' || progress.source.name === 'archivePrompts')
        usageSourceStatus.set(progress.source.name, progress.source.status)
      const activity = scanSession.current()
      if (!activity) return
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(IPC_CHANNELS.scanProgress, {
          id: activity.id,
          source: progress.source
        })
      }
    }
  )
)

async function scanAndNotify(
  urgency: ScanUrgency = 'announce',
  fresh = false,
  scope: ScanScope = 'all'
): Promise<ScanSummary> {
  const previousSuccess = scanSummary?.lastSuccessfulAt ?? null
  const { run, started, promoted } = scanSession.begin(Date.now(), urgency)
  if (started || promoted) notifyScanStarted(run)
  try {
    try {
      scanSummary = await scans.request({ fresh, scope })
    } catch (error) {
      console.error('[ingest] scan failed', error)
      scanSummary =
        error instanceof ScanWorkerError
          ? error.summary
          : {
              outcome: 'failed',
              completedAt: new Date().toISOString(),
              sources: [{ name: 'scanWorker', status: 'failed', failureReason: 'worker_crash' }]
            }
    }
    scanSummary = {
      ...scanSummary,
      isStartup: run.isStartup,
      lastSuccessfulAt:
        scanSummary.outcome === 'complete' ? scanSummary.completedAt : previousSuccess
    }
    if (scanSummary.projects) {
      try {
        themeStore.set('projectFolders', scanSummary.projects)
      } catch (error) {
        console.error('[ingest] could not save project catalog', error)
      }
    }
    scanComplete = true
    return scanSummary
  } finally {
    const finished = scanSession.end()
    if (finished && scanSummary) {
      lastScanFinished = { id: finished.id, summary: scanSummary }
      notifyScanFinished(lastScanFinished)
    }
  }
}

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 720,
    minWidth: 860,
    minHeight: 500,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const } : {}),
    ...(process.platform === 'linux' ? { icon } : {}),
    ...(process.platform === 'win32' ? { icon: windowsIcon } : {}),
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false
    }
  })

  const rendererUrl =
    is.dev && process.env['ELECTRON_RENDERER_URL'] ? process.env['ELECTRON_RENDERER_URL'] : APP_URL
  trustedWindows.set(mainWindow.webContents, rendererUrl)
  mainWindow.webContents.on('destroyed', () => trustedWindows.delete(mainWindow.webContents))
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedRendererUrl(url, rendererUrl)) event.preventDefault()
  })
  mainWindow.webContents.on('will-frame-navigate', (event) => {
    if (!event.isMainFrame || !isTrustedRendererUrl(event.url, rendererUrl)) event.preventDefault()
  })
  mainWindow.webContents.on('will-redirect', (event, url) => {
    if (!isTrustedRendererUrl(url, rendererUrl)) event.preventDefault()
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  // If the scan started or finished before the renderer subscribed, replay the current
  // fact so the banner and the post-scan refresh aren't stuck on a missed event.
  mainWindow.webContents.on('did-finish-load', () => {
    const active = scanSession.current()
    if (active) {
      mainWindow.webContents.send(IPC_CHANNELS.scanStarted, active)
    } else if (lastScanFinished) {
      mainWindow.webContents.send(IPC_CHANNELS.scanComplete, lastScanFinished)
    }
    if (updates) mainWindow.webContents.send(IPC_CHANNELS.updateState, updates.getState())
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    openSafeExternal(details.url, (url) => {
      void shell.openExternal(url)
    })
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadURL(APP_URL)
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  session.defaultSession.setPermissionCheckHandler(() => false)
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) =>
    callback(false)
  )
  session.defaultSession.setDevicePermissionHandler(() => false)
  protocol.handle('megatron', async (request) => {
    const asset = resolveBundledAsset(request.url, join(import.meta.dirname, '../renderer'))
    if (request.method !== 'GET' || asset === null)
      return new Response('Unavailable', { status: 404 })
    // This capability serves only packaged assets; it never accepts a user filesystem path.
    const response = await net.fetch(pathToFileURL(asset).href)
    const headers = new Headers(response.headers)
    headers.set('Content-Security-Policy', APP_CONTENT_SECURITY_POLICY)
    headers.set('X-Content-Type-Options', 'nosniff')
    return new Response(response.body, { status: response.status, headers })
  })
  // Set app user model id for windows
  // Must match electron-builder's appId, which the NSIS installer stamps on the Start menu
  // shortcut; a mismatch splits taskbar pinning and notifications from the installed app.
  electronApp.setAppUserModelId('com.megatron.app')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  secureIpc.handle(IPC_CHANNELS.listSkills, (): SkillsListResult => {
    const skills = listSkills(getDb())
    const staleIds = usageDataTrusted(usageSourceStatus)
      ? findStaleSkillIds(getDb(), getUsageArchive(), skills)
      : new Set<number>()
    return {
      skills: skills.map((skill) => ({ ...skill, stale: staleIds.has(skill.id) })),
      scanComplete,
      scanSummary,
      scanActivity: scanSession.current(),
      contextBudget: getContextBudget(getDb())
    }
  })

  secureIpc.handle(IPC_CHANNELS.openSkill, (_event, id: number): OpenSkillResult | null => {
    const skill = getSkillById(getDb(), id)
    if (!skill) return null
    const findings = getLintFindingsForSkill(getDb(), id)
    return {
      skill,
      files: readSkillFiles(skill.source_path),
      usage: getSkillUsageDetail(getDb(), skill),
      findings
    }
  })

  secureIpc.handle(IPC_CHANNELS.openSkillMeta, (_event, id: number): OpenSkillMetaResult | null => {
    const skill = getSkillById(getDb(), id)
    if (!skill) return null
    const skillMd = readSkillMd(skill.source_path)
    const findings = getLintFindingsForSkill(getDb(), id)
    return {
      skill,
      usage: getSkillUsageDetail(getDb(), skill),
      skillMdContent: skillMd?.status === 'ok' ? skillMd.content : null,
      findings
    }
  })

  secureIpc.handle(
    IPC_CHANNELS.openSkillHistory,
    (_event, id: number, offset = 0): SkillInvocationEntry[] => {
      const skill = getSkillById(getDb(), id)
      return skill ? getSkillInvocationLog(getDb(), skill, INVOCATION_PAGE_SIZE, offset) : []
    }
  )

  secureIpc.on(IPC_CHANNELS.getInitialTheme, (event) => {
    event.returnValue = resolveInitialTheme(themeStore)
  })

  secureIpc.handle(IPC_CHANNELS.setTheme, (_event, theme: ThemePreference) => {
    setStoredTheme(themeStore, theme)
  })

  secureIpc.handle(IPC_CHANNELS.listAllowedPaths, () => {
    return listAllowedPaths(themeStore)
  })
  secureIpc.handle(IPC_CHANNELS.listProjects, () =>
    sanitizeProjectFolders(themeStore.get('projectFolders')).filter((project) =>
      isPathAllowed(project.path)
    )
  )

  async function pickFolders(
    sender: Electron.WebContents,
    options: Electron.OpenDialogOptions
  ): Promise<string[]> {
    const window = BrowserWindow.fromWebContents(sender)
    const dialogOptions: Electron.OpenDialogOptions = {
      ...options,
      properties: ['openDirectory', 'multiSelections']
    }
    const result = window
      ? await dialog.showOpenDialog(window, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions)
    return result.canceled ? [] : result.filePaths
  }

  // Every grant change, so add, narrow and revoke share one ordering: persist first (a failed
  // write leaves access as it was), then update in-memory access, then drop skills no longer
  // readable. Picks are only registered once known not to be covered by another grant.
  async function changeGrants(picks: string[], remove: string[]): Promise<GrantChangeResult> {
    const selected = new Map(picks.map((pick) => [canonicalGrantPath(pick), pick]))
    // Outside the try: a worker that can't be stopped must leave access and scans untouched.
    await scans.cancel()
    try {
      const change = changeAllowedPaths(themeStore, { add: [...selected.keys()], remove })
      for (const path of [...remove, ...change.absorbed]) revokePath(path)
      for (const path of change.added) grantPath(selected.get(path)!)
      for (const path of remove) deleteSkillsForProjectRoot(getDb(), path, isPathAllowed)
      return { folders: change.next, skipped: change.skipped }
    } finally {
      inventoryWatcher?.update()
      void scanAndNotify()
    }
  }

  secureIpc.handle(IPC_CHANNELS.pickAndAddFolders, async (event) => {
    // The starting folder comes from main's own record of where Claude Code ran, so the renderer
    // still never names a path; it only saves the user navigating there.
    const defaultPath = suggestGrantStart(
      usageProjectLocations()
        .filter((location) => location.status === 'needs_access')
        .map((location) => location.path),
      listAllowedPaths(themeStore).map((row) => row.path),
      homedir()
    )
    const picks = await pickFolders(event.sender, {
      title: 'Grant Project or Parent Folder',
      message: GRANT_GUIDANCE,
      ...(defaultPath ? { defaultPath } : {})
    })
    return picks.length === 0
      ? { folders: listAllowedPaths(themeStore), skipped: [] }
      : changeGrants(picks, [])
  })

  secureIpc.handle(IPC_CHANNELS.narrowAllowedPath, async (event, path: string) => {
    // Only an existing grant can be narrowed, and the replacement folders come from the native
    // dialog, so the renderer still can never name a folder to grant.
    const grant = listAllowedPaths(themeStore).find((row) => row.path === path)
    if (!grant) throw new Error('Folder is not granted')
    const picks = await pickFolders(event.sender, {
      title: 'Choose Folders to Keep',
      message: `Choose the folders inside ${basename(grant.path)} to keep. Everything else in it loses access.`,
      defaultPath: grant.path
    })
    return picks.length === 0
      ? { folders: listAllowedPaths(themeStore), skipped: [] }
      : changeGrants(picks, [grant.path])
  })

  secureIpc.handle(
    IPC_CHANNELS.revokeAllowedPath,
    async (_event, path: string) => (await changeGrants([], [path])).folders
  )

  secureIpc.handle(IPC_CHANNELS.openExternal, (_event, url: string) => {
    openSafeExternal(url, (safeUrl) => {
      void shell.openExternal(safeUrl)
    })
  })

  secureIpc.handle(IPC_CHANNELS.listPlugins, () => listPlugins(getDb()))

  secureIpc.handle(IPC_CHANNELS.getPluginDetail, (_event, name: string, marketplace: string) =>
    getPluginDetail(getDb(), name, marketplace)
  )

  const pluginActions = createPluginActionService({
    execute: {
      enable: enablePlugin,
      disable: disablePlugin,
      update: updatePlugin,
      uninstall: uninstallPlugin
    },
    refresh: (scope) =>
      scope === 'plugins'
        ? scans.request({ scope: 'plugins', fresh: true })
        : scanAndNotify('quiet', true),
    readDetail: (input) => getPluginDetail(getDb(), input.name, input.marketplace),
    scheduleBackground: () => {
      setImmediate(() => void scanAndNotify('quiet'))
    },
    reportError: (verb, error) => console.error('[plugins] action verification failed', verb, error)
  })
  secureIpc.handle(IPC_CHANNELS.enablePlugin, (_event, input: PluginActionInput) =>
    pluginActions.run('enable', input)
  )
  secureIpc.handle(IPC_CHANNELS.disablePlugin, (_event, input: PluginActionInput) =>
    pluginActions.run('disable', input)
  )
  secureIpc.handle(IPC_CHANNELS.updatePlugin, (_event, input: PluginActionInput) =>
    pluginActions.run('update', input, (phase) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(IPC_CHANNELS.pluginUpdateProgress, { input, phase })
      }
    })
  )
  secureIpc.handle(IPC_CHANNELS.uninstallPlugin, (_event, input: PluginActionInput) =>
    pluginActions.run('uninstall', input)
  )

  // Composes like skills:list — the renderer polls until scanComplete.
  secureIpc.handle(IPC_CHANNELS.usageOverview, () => {
    const now = new Date()
    const db = getDb()
    return {
      ...getUsageOverviewData(db, getUsageArchive(), usageProjectLocations(), now),
      scanComplete: usageComplete || scanComplete,
      scanSummary
    }
  })

  // Neither touches the index: /context runs the CLI from Megatron's own data folder, and the
  // recorded request is read from the transcript on demand and discarded after the reply.
  secureIpc.handle(IPC_CHANNELS.usageContextBaseline, () =>
    measureContextBaseline(app.getPath('userData'))
  )
  secureIpc.handle(IPC_CHANNELS.usageRecordedRequest, () => findNewestRecordedRequest())

  secureIpc.handle(IPC_CHANNELS.usageCalendar, (_event, year: number) =>
    getProjectUsageCalendar(getUsageArchive(), year, usageProjectLocations())
  )
  secureIpc.handle(IPC_CHANNELS.usageDay, (_event, date: string) =>
    getProjectUsageDay(getUsageArchive(), date, usageProjectLocations())
  )
  secureIpc.handle(IPC_CHANNELS.usageProjects, () => usageProjectCatalog(usageProjectLocations()))
  secureIpc.handle(
    IPC_CHANNELS.usageLinkProjects,
    (_event, input: { sourceId: string; targetId: string }) => {
      const locations = linkUsageProjects(usageProjectLocations(), input.sourceId, input.targetId)
      themeStore.set('usageProjects', locations)
      return usageProjectCatalog(locations)
    }
  )
  secureIpc.handle(IPC_CHANNELS.usageUnlinkProject, (_event, locationId: string) => {
    const locations = unlinkUsageProject(usageProjectLocations(), locationId)
    themeStore.set('usageProjects', locations)
    return usageProjectCatalog(locations)
  })

  secureIpc.handle(
    IPC_CHANNELS.usageSkillInvocations,
    (_event, input: SkillInvocationSliceInput): SkillInvocationRecord[] =>
      getSkillInvocationSlice(getDb(), input)
  )

  secureIpc.on(IPC_CHANNELS.getInitialSection, (event) => {
    event.returnValue = resolveInitialSection(themeStore)
  })

  secureIpc.handle(IPC_CHANNELS.setLastSection, (_event, section: AppSection) => {
    setStoredSection(themeStore, section)
  })

  secureIpc.on(IPC_CHANNELS.getInitialOnboarding, (event) => {
    event.returnValue = resolveOnboarding(themeStore)
  })

  secureIpc.handle(IPC_CHANNELS.setOnboardingDone, () => markOnboardingDone(themeStore))

  // Await the isolated scan; the completion broadcast invalidates renderer queries.
  secureIpc.handle(IPC_CHANNELS.rescan, () => scanAndNotify('announce', true))

  // openPath on the data folder rather than showItemInFolder on the db file: the folder
  // always exists (the index may have been deleted), and the documented recovery path also
  // removes the -wal/-shm siblings, which the folder view shows.
  secureIpc.handle(IPC_CHANNELS.revealDataFolder, () => shell.openPath(app.getPath('userData')))

  secureIpc.on(IPC_CHANNELS.getVersion, (event) => {
    event.returnValue = appVersion
  })

  // The sandboxed preload has no `os`; the renderer needs home to root the project tree.
  secureIpc.on(IPC_CHANNELS.getHomePath, (event) => {
    event.returnValue = homedir()
  })

  const updateService = createUpdater({
    updater: electronUpdater.autoUpdater,
    platform: process.platform,
    isPackaged: app.isPackaged,
    store: themeStore,
    broadcast: (state) => {
      for (const window of BrowserWindow.getAllWindows())
        window.webContents.send(IPC_CHANNELS.updateState, state)
    },
    openExternal: (url) => {
      openSafeExternal(url, (safeUrl) => {
        void shell.openExternal(safeUrl)
      })
    }
  })
  updates = updateService
  secureIpc.handle(IPC_CHANNELS.getUpdateState, () => updateService.getState())
  secureIpc.handle(IPC_CHANNELS.checkForUpdates, () => updateService.check())
  secureIpc.handle(IPC_CHANNELS.installUpdate, () => updateService.install())
  secureIpc.handle(IPC_CHANNELS.setAutoUpdateCheck, (_event, enabled: boolean) =>
    updateService.setAutoCheck(enabled)
  )
  secureIpc.handle(IPC_CHANNELS.openUpdateDownload, () => updateService.openDownload())

  createWindow()
  updateService.start()

  setImmediate(() => {
    normalizeAllowedPaths(themeStore)
    const allowed = listAllowedPaths(themeStore)
    for (const row of allowed) {
      restoreGrantedPath(row.path)
    }
    inventoryWatcher = createInventoryWatcher({
      getRoots: () => [
        ...getGrantedPaths().map((path) => ({ path, kind: 'project' as const })),
        ...[
          join(homedir(), '.claude', 'skills'),
          join(homedir(), '.claude', 'plugins'),
          join(homedir(), '.claude', 'settings.json'),
          join(homedir(), '.claude.json')
        ].map((path) => ({ path, kind: 'inventory' as const }))
      ],
      refresh: () => scanAndNotify('quiet', true, 'inventory'),
      reportError: (error) => console.error('[inventory] watch or refresh failed', error)
    })
    void scanAndNotify('startup')
  })

  let lastFocusScan = 0
  app.on('browser-window-focus', () => {
    if (scanComplete && Date.now() - lastFocusScan > MIN_FOCUS_SCAN_INTERVAL_MS) {
      lastFocusScan = Date.now()
      void scanAndNotify('quiet')
    }
  })

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  inventoryWatcher?.close()
  void scans.cancel()
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
