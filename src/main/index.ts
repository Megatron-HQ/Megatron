import { app, shell, BrowserWindow, dialog, ipcMain, net, protocol, session } from 'electron'
import { watchFile, writeFileSync } from 'fs'
import { spawn } from 'child_process'
import { randomBytes } from 'crypto'
import { basename, join, resolve } from 'path'
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
import { getDb, getUsageArchive, usageArchivePath } from './db'
import {
  getUsageOverviewData,
  getProjectUsageCalendar,
  getProjectUsageDay,
  usageProjectCatalog,
  usageSessionPaths,
  readClaudeAppChats
} from './usage-projects'
import type { UsageProjectCatalog } from '../shared/usage-projects'
import { createProjectIdentity } from './project-identity'
import { createScanSession, type ScanUrgency } from './scan-session'
import { disableChromiumHttpCache } from './chromium-cache'
import { changeAllowedPaths, listAllowedPaths, normalizeAllowedPaths } from './folder-grants'
import { isExistingDirectory } from './folder-existence'
import { hideProject, readHiddenProjects, showProject, unhideForPicks } from './hidden-projects'
import { createUpdater, type Updates } from './updater'
import { readSwapResult, scheduleSwap, selfUpdateBlocker, stageUpdate } from './mac-self-update'
import { claimSingleInstance } from './single-instance'
import { ownedDataFolder, separateDevDataFolder } from './data-folder'
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
  listSkills,
  recordedProjectPaths
} from './db/queries'
import {
  allowedLinkTargetSync,
  canonicalGrantPath,
  claudeConfig,
  executableStatusSync,
  getGrantedPaths,
  isPathAllowed,
  isWithinGrant,
  grantPath,
  restoreGrantedPath,
  revokePath,
  securePrivateDataDirectory,
  setClaudeConfig
} from './permissions'
import { createClaudeFolder } from './claude-folder'
import { CLAUDE_NOT_FOUND_MESSAGE, gateClaude } from './claude-process'
import { resolveClaudeCommand } from './claude-cli'
import { openLoginTerminal } from './mcp-login'
import {
  markOnboardingDone,
  resolveInitialSection,
  resolveInitialTheme,
  resolveOnboarding,
  setStoredSection,
  setStoredTheme,
  type ThemeStore
} from './theme'
import {
  activeWhatsNewDots,
  clearWhatsNewDot,
  markWhatsNewSeen,
  recordWhatsNewBaseline,
  resolveWhatsNewInitialState
} from './whats-new-state'
import { parseWhatsNewCatalog, type WhatsNewAnchorId } from '../shared/whats-new'
import whatsNewJson from '../shared/whats-new.json'
import { matchRecordedFolder, suggestGrantStart } from '../shared/grant-suggestions'
import { isHiddenProject } from '../shared/project-path'
import { WINDOW_SIZE } from '../shared/window-size'
import {
  createScanController,
  ScanWorkerError,
  startScanWorker,
  type ScanScope
} from './ingest/scan-all'
import { createInventoryWatcher, inventoryWatchRoots } from './inventory-watcher'
import { findNewestRecordedRequest } from './ingest/recorded-request'
import { latestContextBaseline, mcpDefinitionTokens, measureContextBaseline } from './context-usage'
import {
  getMcpServerDetail,
  listMcpServers,
  findMcpDeclaration,
  mcpActionTarget,
  mcpAddConflict,
  mcpAddPrecedenceNote,
  mcpLoginTarget,
  mcpProjectApprovals,
  mcpResetTarget,
  revealableMcpSource
} from './db/mcp-queries'
import { mcpActionsIdle, runMcpAction } from './mcp-actions'
import { parseMcpAddInput } from './mcp-add'
import { createMcpActionService } from './mcp-action-service'
import { getMcpUsageStats } from './db/mcp-usage'
import {
  checkMcpConnections,
  checkMcpServer,
  forgetMcpChecks,
  latestMcpChecks,
  mcpCheckFolder
} from './mcp-status'
import { findStaleSkillIds, usageDataTrusted } from './db/stale-skills'
import { usageHistorySince } from './db/known-calls'
import { createCommandLookup, type CommandLookup } from './command-lookup'
import { sanitizeProjectFolders } from './ingest/project-discovery'
import { readSkillFiles, readSkillMd } from './skill-files'
import { openSafeExternal } from './shell'
import {
  disablePlugin,
  enablePlugin,
  pluginActionsIdle,
  uninstallPlugin,
  updatePlugin
} from './plugin-actions'
import { createPluginActionService } from './plugin-action-service'
import {
  GRANT_GUIDANCE,
  IPC_CHANNELS,
  INVOCATION_PAGE_SIZE,
  type AppSection,
  type GrantChangeResult,
  type McpAddResult,
  type McpDeclarationRef,
  type McpLoginRef,
  type OpenSkillMetaResult,
  type OpenSkillResult,
  type PluginActionInput,
  type SkillInvocationEntry,
  type SkillInvocationRecord,
  type SkillInvocationSliceInput,
  type ScanActivity,
  type ScanFinished,
  type ScanResult,
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

// Before anything touches the data folder: pick it (the lock is keyed on it), then a second copy on
// the same data quits here.
separateDevDataFolder(app)
const isPrimaryInstance = claimSingleInstance(app, () => BrowserWindow.getAllWindows())

if (isPrimaryInstance) securePrivateDataDirectory(app.getPath('userData'), ownedDataFolder(app))
const themeStore: ThemeStore = new Store({ name: 'preferences' })

// Before anything reads Claude Code's data: every reader, Tier 1, the scan worker and the CLI follow
// this one folder for the life of the process; choosing another relaunches.
const claudeFolder = createClaudeFolder({
  home: homedir(),
  environment: process.env.CLAUDE_CONFIG_DIR,
  isPrimaryInstance,
  store: themeStore,
  // A stat poll, unlike fs.watch, notices a folder that doesn't exist yet appearing (a drive
  // reconnecting), and it costs one stat every 2 seconds.
  watch: (path, onChange) => watchFile(path, { interval: 2000, persistent: false }, onChange),
  cliActionsIdle: async () => {
    await Promise.all([pluginActionsIdle(), mcpActionsIdle()])
  },
  stopScans: () => scans.cancel(),
  suspendScans: () => {
    usageSourceStatus.clear()
    return scans.suspend()
  },
  resumeScans: () => scans.resume(),
  // exit, not quit: quitting runs before-quit, which would swap in a staged macOS update mid-switch.
  relaunch: () => {
    app.relaunch()
    app.exit(0)
  },
  broadcast: (status) => {
    for (const window of BrowserWindow.getAllWindows())
      window.webContents.send(IPC_CHANNELS.claudeFolderState, status)
  },
  // Deferred: a resume found inside scanAndNotify's own pause check must not start a nested scan.
  onResume: () =>
    setImmediate(() => {
      if (claudeFolder.paused() || claudeFolder.status().state === 'switching') return
      inventoryWatcher?.update()
      void scanAndNotify('announce')
    })
})
setClaudeConfig(claudeFolder.root)
gateClaude(claudeFolder.cliRefusal)
// Bundled and validated by its own test, so a parse failure here means a broken build, not user data.
const whatsNewCatalog = parseWhatsNewCatalog(whatsNewJson)

function grantedProjectFolders(): ReturnType<typeof sanitizeProjectFolders> {
  return sanitizeProjectFolders(themeStore.get('projectFolders')).filter((project) =>
    isPathAllowed(project.path)
  )
}
const projectIdentity = createProjectIdentity({
  store: {
    read: () => themeStore.get('usageProjects'),
    write: (locations) => themeStore.set('usageProjects', locations)
  },
  claudeCodeFolders: [claudeFolder.root.directory, join(homedir(), '.claude')],
  sessionPaths: () => usageSessionPaths(getDb(), getUsageArchive()),
  catalog: grantedProjectFolders
})
// Scan-driven writes only log: the Scan's own result stands even when preferences.json can't be
// written, and the next reconcile moment tries again.
function reconcileProjectIdentity(): void {
  try {
    projectIdentity.reconcile()
  } catch (error) {
    console.error('[usage] could not reconcile Usage projects', error)
  }
}
// Chat titles decorate this IPC result only; the owner persists locations alone.
function usageProjectCatalogWithChats(): UsageProjectCatalog {
  return usageProjectCatalog(
    { ...projectIdentity.snapshot(), locations: projectIdentity.locations() },
    readClaudeAppChats(getDb(), getUsageArchive())
  )
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
    const plugin =
      getPluginDetail(getDb(), projectIdentity.identity(), input.name, input.marketplace)?.plugin ??
      null
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
      archivePath: usageArchivePath(),
      configRoot: claudeConfig(),
      grantedPaths: getGrantedPaths(),
      hiddenProjects: readHiddenProjects(themeStore),
      previousProjects: sanitizeProjectFolders(themeStore.get('projectFolders')),
      projectIdentity: projectIdentity.snapshot()
    },
    undefined,
    (progress) => {
      if (claudeFolder.paused() || claudeFolder.status().state === 'switching') return
      if (progress.type !== 'source-complete') return
      if (progress.source.name === 'archivePrompts') usageComplete = true
      if (progress.source.name === 'scanTranscripts' || progress.source.name === 'archivePrompts') {
        usageSourceStatus.set(progress.source.name, progress.source.status)
        // New working directories become Project Locations before the Usage view reads them.
        reconcileProjectIdentity()
      }
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

// The mcp-command-not-found lint's PATH lookup (docs/mcp-servers.md, Lint). Fresh for each read,
// so a command installed since the last one is found; it memoizes within that read.
function mcpCommandLookup(): (program: string) => CommandLookup {
  return createCommandLookup({
    environment: process.env,
    platform: process.platform,
    statusOf: executableStatusSync
  })
}

async function scanAndNotify(
  urgency: ScanUrgency = 'announce',
  fresh = false,
  scope: ScanScope = 'all'
): Promise<ScanSummary> {
  // A scan of a missing folder would delete every cached row. Cached rows stay on screen, and this
  // summary is never stored, so the folder banner explains the pause instead of a scan warning.
  if (claudeFolder.paused() || claudeFolder.status().state === 'switching') {
    scanComplete = true
    return { outcome: 'failed', completedAt: new Date().toISOString(), sources: [] }
  }
  const previousSuccess = scanSummary?.lastSuccessfulAt ?? null
  const { run, started, promoted } = scanSession.begin(Date.now(), urgency)
  if (started || promoted) notifyScanStarted(run)
  try {
    let result: ScanResult
    try {
      result = await scans.request({ fresh, scope })
    } catch (error) {
      console.error('[ingest] scan failed', error)
      result =
        error instanceof ScanWorkerError
          ? error.summary
          : {
              outcome: 'failed',
              completedAt: new Date().toISOString(),
              sources: [{ name: 'scanWorker', status: 'failed', failureReason: 'worker_crash' }]
            }
    }
    const paused = claudeFolder.paused()
    // The renderer gets the summary only; the catalog, findings and gone folders stay in main.
    const { projects, findings, goneFolders, ...summary } = result
    scanSummary = {
      ...summary,
      ...(paused
        ? {
            outcome: 'failed' as const,
            sources: [
              {
                name: 'scanWorker',
                status: 'failed' as const,
                failureReason: 'scan_error' as const,
                issues: [{ code: 'source_unavailable' as const, path: claudeFolder.root.directory }]
              }
            ]
          }
        : {}),
      isStartup: run.isStartup,
      lastSuccessfulAt:
        !paused && summary.outcome === 'complete' ? summary.completedAt : previousSuccess
    }
    if (!paused) {
      if (projects) {
        try {
          themeStore.set('projectFolders', projects)
        } catch (error) {
          console.error('[ingest] could not save project catalog', error)
        }
      }
      // After the catalog, which the owner reads while it reconciles.
      try {
        projectIdentity.recordScan(findings, goneFolders)
      } catch (error) {
        console.error('[ingest] could not save Usage project identity', error)
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
    width: WINDOW_SIZE.default.width,
    height: WINDOW_SIZE.default.height,
    minWidth: WINDOW_SIZE.min.width,
    minHeight: WINDOW_SIZE.min.height,
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
  if (!isPrimaryInstance) return
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
    // One identity for both sides, so invocations and opportunity agree on every Worktree.
    const identity = projectIdentity.identity()
    const skills = listSkills(getDb(), identity)
    const staleIds = usageDataTrusted(usageSourceStatus)
      ? findStaleSkillIds(getDb(), getUsageArchive(), skills, identity)
      : new Set<number>()
    return {
      skills: skills.map((skill) => ({ ...skill, stale: staleIds.has(skill.id) })),
      scanComplete,
      scanSummary,
      scanActivity: scanSession.current(),
      contextBudget: getContextBudget(getDb()),
      usesSince: usageHistorySince(getDb())
    }
  })

  secureIpc.handle(IPC_CHANNELS.openSkill, (_event, id: number): OpenSkillResult | null => {
    const identity = projectIdentity.identity()
    const skill = getSkillById(getDb(), identity, id)
    if (!skill) return null
    const findings = getLintFindingsForSkill(getDb(), id)
    return {
      skill,
      files: readSkillFiles(skill.source_path),
      usage: getSkillUsageDetail(getDb(), identity, skill),
      findings
    }
  })

  secureIpc.handle(IPC_CHANNELS.openSkillMeta, (_event, id: number): OpenSkillMetaResult | null => {
    const identity = projectIdentity.identity()
    const skill = getSkillById(getDb(), identity, id)
    if (!skill) return null
    const skillMd = readSkillMd(skill.source_path)
    const findings = getLintFindingsForSkill(getDb(), id)
    return {
      skill,
      usage: getSkillUsageDetail(getDb(), identity, skill),
      skillMdContent: skillMd?.status === 'ok' ? skillMd.content : null,
      findings,
      linkTarget: allowedLinkTargetSync(skill.source_path)
    }
  })

  secureIpc.handle(
    IPC_CHANNELS.openSkillHistory,
    (_event, id: number, offset = 0): SkillInvocationEntry[] => {
      const identity = projectIdentity.identity()
      const skill = getSkillById(getDb(), identity, id)
      return skill
        ? getSkillInvocationLog(getDb(), identity, skill, INVOCATION_PAGE_SIZE, offset)
        : []
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
  secureIpc.handle(IPC_CHANNELS.listProjects, () => grantedProjectFolders())

  async function pickFolders(
    sender: Electron.WebContents,
    options: Electron.OpenDialogOptions,
    properties: Electron.OpenDialogOptions['properties'] = ['openDirectory', 'multiSelections']
  ): Promise<string[]> {
    const window = BrowserWindow.fromWebContents(sender)
    const dialogOptions: Electron.OpenDialogOptions = { ...options, properties }
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
      // Every pick, skipped ones too: picking a hidden folder is asking to see it. Both spellings,
      // since Claude Code may have recorded the folder through a link. Display only, so a failed
      // write must not fail a grant that already happened.
      try {
        unhideForPicks(themeStore, [...selected.keys(), ...selected.values()])
      } catch (error) {
        console.error('[folders] could not show picked folders again', error)
      }
      return { folders: change.next, skipped: change.skipped }
    } finally {
      inventoryWatcher?.update()
      void scanAndNotify()
    }
  }

  // A folder the renderer names is only ever one main showed it: it must match main's own record
  // of where Claude Code ran, and main acts on that record's spelling, never the renderer's.
  function recordedFolder(candidate: string): string | undefined {
    return matchRecordedFolder(
      candidate,
      [
        ...projectIdentity.locations().map((location) => location.path),
        ...recordedProjectPaths(getDb()),
        ...grantedProjectFolders().map((project) => project.path)
      ],
      homedir()
    )
  }

  secureIpc.handle(IPC_CHANNELS.pickAndAddFolders, async (event, target?: string) => {
    const grants = listAllowedPaths(themeStore).map((row) => row.path)
    const recorded = target === undefined ? undefined : recordedFolder(target)
    const aimed =
      recorded !== undefined &&
      !grants.some((grant) => isWithinGrant(recorded, grant)) &&
      // A missing folder must not reach the picker: Windows would type its name into the Folder
      // box, and confirming would fail.
      isExistingDirectory(recorded)
        ? recorded
        : undefined
    if (aimed) {
      const name = basename(aimed)
      const picks = await pickFolders(event.sender, {
        title: `Add ${name}`,
        buttonLabel: 'Add',
        message: `Click Add to let Megatron read ${name}, or go up to choose a parent folder.`,
        defaultPath: aimed
      })
      return picks.length === 0
        ? { folders: listAllowedPaths(themeStore), skipped: [] }
        : changeGrants(picks, [])
    }
    // The starting folder comes from main's own record of where Claude Code ran, so the renderer
    // still never names a path; it only saves the user navigating there.
    const hidden = readHiddenProjects(themeStore)
    const defaultPath = suggestGrantStart(
      projectIdentity
        .locations()
        .filter(
          (location) =>
            location.status === 'needs_access' &&
            !location.worktree &&
            !isHiddenProject(location.path, hidden)
        )
        .map((location) => location.path),
      grants,
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

  // Display only: Claude Code's files and the folder are untouched, and access is unchanged.
  // A fresh scan rebuilds the index with or without the folder's plugin installs, MCP state and
  // skills, so every rollup computed from them agrees.
  secureIpc.handle(IPC_CHANNELS.listHiddenProjects, () => readHiddenProjects(themeStore))
  secureIpc.handle(IPC_CHANNELS.hideProject, (_event, path: string) => {
    const target = recordedFolder(path)
    if (target === undefined) throw new Error('Folder is not one Claude Code recorded')
    const hidden = hideProject(themeStore, target)
    void scanAndNotify('announce', true)
    return hidden
  })
  secureIpc.handle(IPC_CHANNELS.showProject, (_event, path: string) => {
    const hidden = showProject(themeStore, path)
    void scanAndNotify('announce', true)
    return hidden
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

  secureIpc.handle(IPC_CHANNELS.getClaudeFolder, () => claudeFolder.status())
  // By id only: the renderer picks from the folders main listed, never names a path.
  secureIpc.handle(IPC_CHANNELS.chooseClaudeFolder, (_event, id: string) => claudeFolder.choose(id))
  secureIpc.handle(IPC_CHANNELS.pickClaudeFolder, (event) =>
    claudeFolder.pickFolder(async () => {
      const [path] = await pickFolders(
        event.sender,
        {
          title: 'Choose Claude Code Folder',
          message: 'Choose the folder Claude Code keeps its settings and history in.',
          defaultPath: homedir()
        },
        // macOS hides dot-folders, and every Claude Code profile folder is one.
        ['openDirectory', 'showHiddenFiles']
      )
      return path ?? null
    })
  )

  secureIpc.handle(IPC_CHANNELS.openExternal, (_event, url: string) => {
    openSafeExternal(url, (safeUrl) => {
      void shell.openExternal(safeUrl)
    })
  })

  secureIpc.handle(IPC_CHANNELS.listPlugins, () => listPlugins(getDb()))

  secureIpc.handle(IPC_CHANNELS.getPluginDetail, (_event, name: string, marketplace: string) =>
    getPluginDetail(getDb(), projectIdentity.identity(), name, marketplace)
  )

  secureIpc.handle(IPC_CHANNELS.listMcpServers, () =>
    listMcpServers(getDb(), latestMcpChecks().general, mcpCommandLookup())
  )

  // Starts the user's MCP servers, so it runs only on request (docs/mcp-servers.md, Live check).
  secureIpc.handle(IPC_CHANNELS.checkMcpConnections, (_event, projectPath?: string) =>
    checkMcpConnections(projectPath ?? null, app.getPath('userData'))
  )

  secureIpc.on(IPC_CHANNELS.getInitialMcpCheckConfirmed, (event) => {
    event.returnValue = themeStore.get('mcpCheckConfirmed') === true
  })

  secureIpc.handle(IPC_CHANNELS.confirmMcpCheck, () => {
    themeStore.set('mcpCheckConfirmed', true)
  })

  secureIpc.handle(IPC_CHANNELS.revealMcpSource, (_event, id: string, path: string) => {
    const target = revealableMcpSource(getDb(), id, path)
    if (target !== null) shell.showItemInFolder(target)
    return target !== null
  })

  // Reads the last /context run only; the MCP section never starts one (docs/mcp-servers.md).
  secureIpc.handle(IPC_CHANNELS.getMcpServerDetail, (_event, id: string) => {
    const baseline = latestContextBaseline()
    return getMcpServerDetail(
      getDb(),
      id,
      baseline === null
        ? null
        : { byPrefix: mcpDefinitionTokens(baseline.usage), measuredAt: baseline.measuredAt },
      latestMcpChecks(),
      mcpCommandLookup()
    )
  })

  const pluginActions = createPluginActionService({
    execute: {
      enable: enablePlugin,
      disable: disablePlugin,
      update: updatePlugin,
      uninstall: uninstallPlugin
    },
    refresh: (scope) =>
      scope === 'plugins' && !claudeFolder.paused()
        ? scans.request({ scope: 'plugins', fresh: true })
        : scanAndNotify('quiet', true),
    readDetail: (input) =>
      getPluginDetail(getDb(), projectIdentity.identity(), input.name, input.marketplace),
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

  // Writes go only through `claude mcp` (docs/mcp-servers.md, Writes); a plugins-scope scan
  // rereads the Declarations they change.
  const mcpActions = createMcpActionService({
    target: (ref, verb) => mcpActionTarget(getDb(), ref, verb),
    resetTarget: (projectPath) => mcpResetTarget(getDb(), projectPath),
    approvals: (projectPath) => mcpProjectApprovals(getDb(), projectPath),
    folder: (projectPath) => mcpCheckFolder(projectPath, app.getPath('userData'), 'change'),
    run: runMcpAction,
    refresh: () =>
      claudeFolder.paused()
        ? scanAndNotify('quiet', true)
        : scans.request({ scope: 'plugins', fresh: true }),
    serverStatus: checkMcpServer,
    forgetChecks: forgetMcpChecks,
    reportError: (action, error) =>
      console.error('[mcp] action verification failed', action, error),
    addConflict: (name, scope, projectPath) => mcpAddConflict(getDb(), name, scope, projectPath),
    findDeclaration: (name, scope, projectPath) =>
      findMcpDeclaration(getDb(), name, scope, projectPath),
    lookupCommand: (program) => mcpCommandLookup()(program),
    precedenceNote: (name, scope, projectPath) =>
      mcpAddPrecedenceNote(getDb(), name, scope, projectPath),
    loginTarget: (ref) => mcpLoginTarget(getDb(), ref),
    openLoginTerminal: (name, cwd) => {
      // The same gate every CLI run passes (claude-process.ts): never a missing or switching folder.
      const refusal = claudeFolder.cliRefusal()
      if (refusal !== null) return Promise.resolve({ ok: false, error: refusal })
      const command = resolveClaudeCommand(cwd)
      if (command === null) return Promise.resolve({ ok: false, error: CLAUDE_NOT_FOUND_MESSAGE })
      return openLoginTerminal(name, cwd, {
        platform: process.platform,
        command,
        systemRoot: process.env.SystemRoot ?? 'C:\\Windows',
        scriptFolder: app.getPath('userData'),
        spawn: (file, args, options) => spawn(file, args, options),
        writeFile: (path, text, mode) => writeFileSync(path, text, { mode }),
        randomName: () => randomBytes(8).toString('hex')
      })
    }
  })
  // The input may hold credentials: it goes to the CLI's stdin and is never logged or stored.
  secureIpc.handle(IPC_CHANNELS.addMcpServer, (_event, input: unknown): Promise<McpAddResult> => {
    const parsed = parseMcpAddInput(input)
    return parsed.ok ? mcpActions.add(parsed.value) : Promise.resolve(parsed)
  })
  secureIpc.handle(IPC_CHANNELS.loginMcpServer, (_event, ref: McpLoginRef) => mcpActions.login(ref))
  secureIpc.handle(IPC_CHANNELS.checkMcpSignIn, (_event, ref: McpLoginRef) =>
    mcpActions.checkSignIn(ref)
  )
  secureIpc.handle(IPC_CHANNELS.removeMcpServer, (_event, ref: McpDeclarationRef) =>
    mcpActions.remove(ref)
  )
  secureIpc.handle(IPC_CHANNELS.logoutMcpServer, (_event, ref: McpDeclarationRef) =>
    mcpActions.logout(ref)
  )
  secureIpc.handle(IPC_CHANNELS.resetMcpProjectChoices, (_event, projectPath: string) =>
    mcpActions.resetProjectChoices(projectPath)
  )

  // Composes like skills:list — the renderer polls until scanComplete.
  secureIpc.handle(IPC_CHANNELS.usageOverview, () => {
    const now = new Date()
    const db = getDb()
    return {
      ...getUsageOverviewData(db, getUsageArchive(), projectIdentity.identity(), now),
      scanComplete: usageComplete || scanComplete,
      scanSummary
    }
  })

  // Neither touches the index: /context runs the CLI from Megatron's own data folder, and the
  // recorded request is read from the transcript on demand and discarded after the reply.
  secureIpc.handle(IPC_CHANNELS.usageContextBaseline, () =>
    measureContextBaseline(app.getPath('userData'))
  )
  // The run starts MCP servers and SessionStart hooks, so the panel's first one waits for a
  // one-time confirmation (docs/usage-analytics.md, Resident tax).
  secureIpc.on(IPC_CHANNELS.getInitialResidentTaxConfirmed, (event) => {
    event.returnValue = themeStore.get('residentTaxConfirmed') === true
  })
  secureIpc.handle(IPC_CHANNELS.confirmResidentTax, () => {
    themeStore.set('residentTaxConfirmed', true)
  })
  secureIpc.handle(IPC_CHANNELS.usageRecordedRequest, () => findNewestRecordedRequest())

  secureIpc.handle(IPC_CHANNELS.usageCalendar, (_event, year: number) =>
    getProjectUsageCalendar(getUsageArchive(), year, projectIdentity.identity())
  )
  secureIpc.handle(IPC_CHANNELS.usageDay, (_event, date: string) =>
    getProjectUsageDay(getUsageArchive(), date, projectIdentity.identity())
  )
  secureIpc.handle(IPC_CHANNELS.usageProjects, () => usageProjectCatalogWithChats())
  // Errors, including a failed write, go back to the renderer: nothing changed.
  secureIpc.handle(
    IPC_CHANNELS.usageLinkProjects,
    (_event, input: { sourceId: string; targetId: string }) => {
      projectIdentity.link(input.sourceId, input.targetId)
      return usageProjectCatalogWithChats()
    }
  )
  secureIpc.handle(IPC_CHANNELS.usageUnlinkProject, (_event, locationId: string) => {
    projectIdentity.unlink(locationId)
    return usageProjectCatalogWithChats()
  })

  secureIpc.handle(
    IPC_CHANNELS.usageSkillInvocations,
    (_event, input: SkillInvocationSliceInput): SkillInvocationRecord[] =>
      getSkillInvocationSlice(getDb(), projectIdentity.identity(), input)
  )

  // Apart from usage:overview, which polls during a scan and needn't build the MCP snapshot.
  secureIpc.handle(IPC_CHANNELS.usageMcp, () =>
    getMcpUsageStats(getDb(), projectIdentity.identity())
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

  secureIpc.handle(IPC_CHANNELS.setOnboardingDone, () => {
    markOnboardingDone(themeStore)
    recordWhatsNewBaseline(themeStore, appVersion)
  })

  secureIpc.on(IPC_CHANNELS.getInitialWhatsNew, (event) => {
    event.returnValue = resolveWhatsNewInitialState(themeStore, {
      releases: whatsNewCatalog.releases,
      currentVersion: appVersion,
      now: new Date()
    })
  })

  secureIpc.handle(IPC_CHANNELS.markWhatsNewSeen, () => {
    const now = new Date()
    markWhatsNewSeen(themeStore, {
      releases: whatsNewCatalog.releases,
      currentVersion: appVersion,
      now
    })
    return activeWhatsNewDots(themeStore, now)
  })

  secureIpc.handle(IPC_CHANNELS.clearWhatsNewDot, (_event, anchor: WhatsNewAnchorId) =>
    clearWhatsNewDot(themeStore, anchor)
  )

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

  // Contents/MacOS/Megatron -> Megatron.app. Only the macOS self-update reads these paths; it
  // writes nowhere but this bundle's own location, the staging folder and the result file.
  const bundlePath = resolve(app.getPath('exe'), '..', '..', '..')
  const swapResultFile = join(app.getPath('userData'), 'update-failure.txt')
  // Inside electron-updater's own macOS download cache, which the Homebrew cask's zap removes.
  const stagingDir = join(homedir(), 'Library', 'Caches', 'megatron-updater', 'staged')
  const updateService = createUpdater({
    updater: electronUpdater.autoUpdater,
    platform: process.platform,
    isPackaged: app.isPackaged,
    store: themeStore,
    broadcast: (state) => {
      for (const window of BrowserWindow.getAllWindows())
        window.webContents.send(IPC_CHANNELS.updateState, state)
    },
    selfUpdate: {
      blocker: () => selfUpdateBlocker(bundlePath),
      stage: (zipPath, version) => stageUpdate(zipPath, version, stagingDir),
      scheduleSwap: (staged, relaunch) =>
        scheduleSwap({
          pid: process.pid,
          staged,
          target: bundlePath,
          relaunch,
          resultFile: swapResultFile
        }),
      takeFailure: () => readSwapResult(swapResultFile)
    },
    quit: () => app.quit()
  })
  updates = updateService
  secureIpc.handle(IPC_CHANNELS.getUpdateState, () => updateService.getState())
  secureIpc.handle(IPC_CHANNELS.checkForUpdates, () => updateService.check())
  secureIpc.handle(IPC_CHANNELS.installUpdate, () => updateService.install())
  secureIpc.handle(IPC_CHANNELS.setAutoUpdateCheck, (_event, enabled: boolean) =>
    updateService.setAutoCheck(enabled)
  )

  createWindow()
  updateService.start()

  setImmediate(() => {
    normalizeAllowedPaths(themeStore)
    const allowed = listAllowedPaths(themeStore)
    for (const row of allowed) {
      restoreGrantedPath(row.path)
    }
    // After the grants: the catalog the owner reconciles against is limited to readable folders.
    reconcileProjectIdentity()
    inventoryWatcher = createInventoryWatcher({
      getRoots: () => inventoryWatchRoots(claudeConfig(), getGrantedPaths()),
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
  updates?.beforeQuit()
  inventoryWatcher?.close()
  void scans.cancel()
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
