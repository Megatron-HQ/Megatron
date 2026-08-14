import { ElectronAPI } from '@electron-toolkit/preload'
import type { SkillsListResult, Theme } from '../shared/ipc'

interface Api {
  listSkills: () => Promise<SkillsListResult>
  getInitialTheme: () => Theme
  setTheme: (theme: Theme) => Promise<void>
  onScanComplete: (callback: () => void) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: Api
  }
}
