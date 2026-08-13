import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { IPC_CHANNELS } from '../shared/ipc'
import type { Skill, Invocation, Plugin, Session } from '../shared/types'

// Custom APIs for renderer
const api = {
  getSqliteVersion: (): Promise<string> => ipcRenderer.invoke(IPC_CHANNELS.getSqliteVersion),
  getSkills: (): Promise<Skill[]> => ipcRenderer.invoke(IPC_CHANNELS.getSkills),
  getInvocations: (): Promise<Invocation[]> => ipcRenderer.invoke(IPC_CHANNELS.getInvocations),
  getPlugins: (): Promise<Plugin[]> => ipcRenderer.invoke(IPC_CHANNELS.getPlugins),
  getSessions: (): Promise<Session[]> => ipcRenderer.invoke(IPC_CHANNELS.getSessions)
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
