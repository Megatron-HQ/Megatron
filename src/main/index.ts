import { app, shell, BrowserWindow, dialog, ipcMain } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import {
  canManagePluginInstall,
  isTrustedIpcSender,
  isTrustedRendererUrl,
  validateIpcArguments
} from './ipc-security'
// Bundled at build time so it always matches package.json — app.getVersion() returns the
// Electron executable's version under `electron-vite dev` (the app has no package.json on
// disk there), not this app's.
import { version as appVersion } from '../../package.json'
import Store from 'electron-store'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
// The .ico, not the PNG, so Windows can pick the hand-tuned no-sparkle art at 16/24 px.
import windowsIcon from '../../resources/icon.ico?asset'
import { getDb } from './db'
import { disableChromiumHttpCache } from './chromium-cache'
import {
  addAllowedPath,
  deleteSkillsForProjectRoot,
  getActivityStats,
  getContextBudget,
  getCostStats,
  getLintFindingsForSkill,
  getModelStats,
  getPluginDetail,
  getResidentTaxStats,
  getSkillStats,
  getSkillById,
  getSkillInvocationLog,
  getSkillInvocationSlice,
  getSkillUsageDetail,
  listAllowedPaths,
  listPlugins,
  listSkills,
  removeAllowedPath
} from './db/queries'
import { grantPath, revokePath } from './permissions'
import {
  resolveInitialSection,
  resolveInitialTheme,
  setStoredSection,
  setStoredTheme,
  type ThemeStore
} from './theme'
import { scanSkills } from './ingest/skills-scanner'
import { scanPluginRegistry } from './ingest/plugin-registry'
import { scanTranscripts } from './ingest/transcript-scanner'
import { scanPromptHistory } from './ingest/prompt-history-scanner'
import { runAllScans } from './ingest/scan-all'
import { runLinter } from './linter'
import { readSkillFiles, readSkillMd } from './skill-files'
import { openSafeExternal } from './shell'
import { disablePlugin, enablePlugin, uninstallPlugin, updatePlugin } from './plugin-actions'
import {
  IPC_CHANNELS,
  type AppSection,
  type OpenSkillMetaResult,
  type OpenSkillResult,
  type PluginActionInput,
  type SkillInvocationEntry,
  type SkillInvocationRecord,
  type SkillInvocationSliceInput,
  type ThemePreference,
  type ScanSummary
} from '../shared/ipc'

// Megatron's renderer is bundled locally, so an HTTP cache adds corruption risk without a
// production benefit. This must run before Electron creates its default session.
disableChromiumHttpCache(app.commandLine)

const themeStore: ThemeStore = new Store({ name: 'preferences' })
let scanComplete = false
let scanSummary: ScanSummary | undefined
const trustedWindows = new Map<Electron.WebContents, string>()

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
    if (
      !canManagePluginInstall(
        input,
        getPluginDetail(getDb(), input.name, input.marketplace)?.plugin ?? null
      )
    ) {
      throw new Error(
        'Plugin installation is unavailable or its settings are unknown. Refresh the plugin list.'
      )
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

function notifyScanComplete(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(IPC_CHANNELS.scanComplete)
  }
}

function scanAndNotify(): ScanSummary {
  const previousSuccess = scanSummary?.lastSuccessfulAt ?? null
  scanSummary = runAllScans(
    getDb(),
    [scanSkills, scanPluginRegistry, scanTranscripts, scanPromptHistory, runLinter],
    (error) => {
      console.error('[ingest] scan failed', error)
    }
  )
  scanSummary.lastSuccessfulAt =
    scanSummary.outcome === 'complete' ? scanSummary.completedAt : previousSuccess
  scanComplete = true
  notifyScanComplete()
  return scanSummary
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
      preload: join(import.meta.dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  const rendererUrl =
    is.dev && process.env['ELECTRON_RENDERER_URL']
      ? process.env['ELECTRON_RENDERER_URL']
      : pathToFileURL(join(import.meta.dirname, '../renderer/index.html')).href
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

  // If the scan finished before the renderer subscribed to scan:complete, replay it
  // so lint findings and usage stats aren't stuck on the pre-lint snapshot.
  mainWindow.webContents.on('did-finish-load', () => {
    if (scanComplete) {
      mainWindow.webContents.send(IPC_CHANNELS.scanComplete)
    }
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
    mainWindow.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  secureIpc.handle(IPC_CHANNELS.listSkills, () => ({
    skills: listSkills(getDb()),
    scanComplete,
    scanSummary,
    contextBudget: getContextBudget(getDb())
  }))

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

  secureIpc.handle(IPC_CHANNELS.openSkillHistory, (_event, id: number): SkillInvocationEntry[] => {
    const skill = getSkillById(getDb(), id)
    return skill ? getSkillInvocationLog(getDb(), skill) : []
  })

  secureIpc.on(IPC_CHANNELS.getInitialTheme, (event) => {
    event.returnValue = resolveInitialTheme(themeStore)
  })

  secureIpc.handle(IPC_CHANNELS.setTheme, (_event, theme: ThemePreference) => {
    setStoredTheme(themeStore, theme)
  })

  secureIpc.handle(IPC_CHANNELS.listAllowedPaths, () => {
    return listAllowedPaths(getDb())
  })

  secureIpc.handle(IPC_CHANNELS.pickAndAddFolders, async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      title: 'Grant Repository Folder',
      properties: ['openDirectory', 'multiSelections']
    }
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) {
      return listAllowedPaths(getDb())
    }
    const db = getDb()
    for (const filePath of result.filePaths) {
      grantPath(filePath)
      addAllowedPath(db, filePath)
    }
    scanAndNotify()
    return listAllowedPaths(db)
  })

  secureIpc.handle(IPC_CHANNELS.revokeAllowedPath, (_event, path: string) => {
    const db = getDb()
    revokePath(path)
    removeAllowedPath(db, path)
    deleteSkillsForProjectRoot(db, path)
    scanAndNotify()
    return listAllowedPaths(db)
  })

  secureIpc.handle(IPC_CHANNELS.openExternal, (_event, url: string) => {
    openSafeExternal(url, (safeUrl) => {
      void shell.openExternal(safeUrl)
    })
  })

  secureIpc.handle(IPC_CHANNELS.listPlugins, () => listPlugins(getDb()))

  secureIpc.handle(IPC_CHANNELS.getPluginDetail, (_event, name: string, marketplace: string) =>
    getPluginDetail(getDb(), name, marketplace)
  )

  secureIpc.handle(IPC_CHANNELS.enablePlugin, async (_event, input: PluginActionInput) => {
    const result = await enablePlugin(input)
    if (result.ok) scanAndNotify()
    return result
  })

  secureIpc.handle(IPC_CHANNELS.disablePlugin, async (_event, input: PluginActionInput) => {
    const result = await disablePlugin(input)
    if (result.ok) scanAndNotify()
    return result
  })

  secureIpc.handle(IPC_CHANNELS.updatePlugin, async (_event, input: PluginActionInput) => {
    const result = await updatePlugin(input)
    if (result.ok) scanAndNotify()
    return result
  })

  secureIpc.handle(IPC_CHANNELS.uninstallPlugin, async (_event, input: PluginActionInput) => {
    const result = await uninstallPlugin(input)
    if (result.ok) scanAndNotify()
    return result
  })

  // Composes like skills:list — the renderer polls until scanComplete.
  secureIpc.handle(IPC_CHANNELS.usageOverview, () => {
    const now = new Date()
    const db = getDb()
    return {
      activity: getActivityStats(db, now),
      cost: getCostStats(db, now),
      models: getModelStats(db, now),
      skills: getSkillStats(db, now),
      residentTax: getResidentTaxStats(db),
      scanComplete,
      scanSummary
    }
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

  // runAllScans is fully synchronous, so scanAndNotify blocks until every scan and the
  // linter finish — the renderer's await on this invoke is the completion signal, and the
  // scan:complete broadcast it fires drives the query invalidation in App.tsx.
  secureIpc.handle(IPC_CHANNELS.rescan, () => scanAndNotify())

  // openPath on the data folder rather than showItemInFolder on the db file: the folder
  // always exists (the index may have been deleted), and the documented recovery path also
  // removes the -wal/-shm siblings, which the folder view shows.
  secureIpc.handle(IPC_CHANNELS.revealDataFolder, () => shell.openPath(app.getPath('userData')))

  secureIpc.on(IPC_CHANNELS.getVersion, (event) => {
    event.returnValue = appVersion
  })

  createWindow()

  setImmediate(() => {
    const allowed = listAllowedPaths(getDb())
    for (const row of allowed) {
      grantPath(row.path)
    }
    scanAndNotify()
  })

  app.on('browser-window-focus', () => {
    if (scanComplete) scanAndNotify()
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

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
