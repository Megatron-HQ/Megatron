import { ElectronAPI } from '@electron-toolkit/preload'
import type { Skill, Invocation, Plugin, Session } from '../shared/types'

interface Api {
  getSqliteVersion: () => Promise<string>
  getSkills: () => Promise<Skill[]>
  getInvocations: () => Promise<Invocation[]>
  getPlugins: () => Promise<Plugin[]>
  getSessions: () => Promise<Session[]>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: Api
  }
}
