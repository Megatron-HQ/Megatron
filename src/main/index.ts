import { app, shell, BrowserWindow, ipcMain, nativeTheme } from 'electron'
import { join } from 'path'
import Store from 'electron-store'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { getDb } from './db'
import { listSkills } from './db/queries'
import { resolveInitialTheme, setStoredTheme, type ThemeStore } from './theme'
import { scanSkills } from './ingest/skills-scanner'
import { scanPluginRegistry } from './ingest/plugin-registry'
import { scanTranscripts } from './ingest/transcript-scanner'
import { IPC_CHANNELS, type Theme } from '../shared/ipc'

const themeStore: ThemeStore = new Store({ name: 'preferences' })
let scanComplete = false

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 720,
    minWidth: 860,
    minHeight: 500,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: 'hiddenInset',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.mjs'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
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
    scanComplete
  }))

  ipcMain.on(IPC_CHANNELS.getInitialTheme, (event) => {
    event.returnValue = resolveInitialTheme(themeStore, nativeTheme.shouldUseDarkColors)
  })

  ipcMain.handle(IPC_CHANNELS.setTheme, (_event, theme: Theme) => {
    setStoredTheme(themeStore, theme)
  })

  createWindow()

  setImmediate(() => {
    const db = getDb()
    for (const scan of [scanSkills, scanPluginRegistry, scanTranscripts]) {
      try {
        scan(db)
      } catch (err) {
        console.error('[ingest] scan failed', err)
      }
    }
    scanComplete = true
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(IPC_CHANNELS.scanComplete)
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

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
