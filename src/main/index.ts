import { app, shell, BrowserWindow, dialog, ipcMain } from 'electron'
import { join } from 'path'
import Store from 'electron-store'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { getDb } from './db'
import {
  addAllowedPath,
  deleteSkillsForProjectRoot,
  getContextBudget,
  getLintFindingsForSkill,
  getPluginDetail,
  getSkillById,
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
  type ThemePreference
} from '../shared/ipc'

const themeStore: ThemeStore = new Store({ name: 'preferences' })
let scanComplete = false

function notifyScanComplete(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(IPC_CHANNELS.scanComplete)
  }
}

function scanAndNotify(): void {
  runAllScans(getDb(), [scanSkills, scanPluginRegistry, scanTranscripts, runLinter], (error) => {
    console.error('[ingest] scan failed', error)
  })
  scanComplete = true
  notifyScanComplete()
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
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.mjs'),
      sandbox: false
    }
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

  ipcMain.handle(IPC_CHANNELS.listSkills, () => ({
    skills: listSkills(getDb()),
    scanComplete,
    contextBudget: getContextBudget(getDb())
  }))

  ipcMain.handle(IPC_CHANNELS.openSkill, (_event, id: number): OpenSkillResult | null => {
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

  ipcMain.handle(IPC_CHANNELS.openSkillMeta, (_event, id: number): OpenSkillMetaResult | null => {
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

  ipcMain.on(IPC_CHANNELS.getInitialTheme, (event) => {
    event.returnValue = resolveInitialTheme(themeStore)
  })

  ipcMain.handle(IPC_CHANNELS.setTheme, (_event, theme: ThemePreference) => {
    setStoredTheme(themeStore, theme)
  })

  ipcMain.handle(IPC_CHANNELS.listAllowedPaths, () => {
    return listAllowedPaths(getDb())
  })

  ipcMain.handle(IPC_CHANNELS.pickAndAddFolders, async (event) => {
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
    try {
      scanSkills(db)
      runLinter(db)
    } catch (err) {
      console.error('[ingest] scanSkills/runLinter failed after grant', err)
    }
    notifyScanComplete()
    return listAllowedPaths(db)
  })

  ipcMain.handle(IPC_CHANNELS.revokeAllowedPath, (_event, path: string) => {
    const db = getDb()
    revokePath(path)
    removeAllowedPath(db, path)
    deleteSkillsForProjectRoot(db, path)
    try {
      runLinter(db)
    } catch (err) {
      console.error('[ingest] runLinter failed after revoke', err)
    }
    notifyScanComplete()
    return listAllowedPaths(db)
  })

  ipcMain.handle(IPC_CHANNELS.openExternal, (_event, url: string) => {
    openSafeExternal(url, (safeUrl) => {
      void shell.openExternal(safeUrl)
    })
  })

  ipcMain.handle(IPC_CHANNELS.listPlugins, () => listPlugins(getDb()))

  ipcMain.handle(IPC_CHANNELS.getPluginDetail, (_event, name: string, marketplace: string) =>
    getPluginDetail(getDb(), name, marketplace)
  )

  ipcMain.handle(IPC_CHANNELS.enablePlugin, async (_event, input: PluginActionInput) => {
    const result = await enablePlugin(input)
    if (result.ok) scanAndNotify()
    return result
  })

  ipcMain.handle(IPC_CHANNELS.disablePlugin, async (_event, input: PluginActionInput) => {
    const result = await disablePlugin(input)
    if (result.ok) scanAndNotify()
    return result
  })

  ipcMain.handle(IPC_CHANNELS.updatePlugin, async (_event, input: PluginActionInput) => {
    const result = await updatePlugin(input)
    if (result.ok) scanAndNotify()
    return result
  })

  ipcMain.handle(IPC_CHANNELS.uninstallPlugin, async (_event, input: PluginActionInput) => {
    const result = await uninstallPlugin(input)
    if (result.ok) scanAndNotify()
    return result
  })

  ipcMain.on(IPC_CHANNELS.getInitialSection, (event) => {
    event.returnValue = resolveInitialSection(themeStore)
  })

  ipcMain.handle(IPC_CHANNELS.setLastSection, (_event, section: AppSection) => {
    setStoredSection(themeStore, section)
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
