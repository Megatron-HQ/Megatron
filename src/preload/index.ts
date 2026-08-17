import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import {
  IPC_CHANNELS,
  type AllowedPathRow,
  type OpenSkillMetaResult,
  type OpenSkillResult,
  type SkillsListResult,
  type Theme
} from '../shared/ipc'

// Custom APIs for renderer
const api = {
  listSkills: (): Promise<SkillsListResult> => ipcRenderer.invoke(IPC_CHANNELS.listSkills),
  openSkill: (id: number): Promise<OpenSkillResult | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.openSkill, id),
  openSkillMeta: (id: number): Promise<OpenSkillMetaResult | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.openSkillMeta, id),
  getInitialTheme: (): Theme => ipcRenderer.sendSync(IPC_CHANNELS.getInitialTheme),
  setTheme: (theme: Theme): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.setTheme, theme),
  listAllowedPaths: (): Promise<AllowedPathRow[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.listAllowedPaths),
  pickAndAddFolders: (): Promise<AllowedPathRow[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.pickAndAddFolders),
  revokeAllowedPath: (path: string): Promise<AllowedPathRow[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.revokeAllowedPath, path),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.openExternal, url),
  onScanComplete: (callback: () => void): (() => void) => {
    const listener = (): void => callback()
    ipcRenderer.on(IPC_CHANNELS.scanComplete, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.scanComplete, listener)
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
