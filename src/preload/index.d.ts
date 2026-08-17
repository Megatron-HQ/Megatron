import { ElectronAPI } from '@electron-toolkit/preload'
import type {
  AllowedPathRow,
  OpenSkillMetaResult,
  OpenSkillResult,
  SkillsListResult,
  Theme
} from '../shared/ipc'

interface Api {
  listSkills: () => Promise<SkillsListResult>
  openSkill: (id: number) => Promise<OpenSkillResult | null>
  openSkillMeta: (id: number) => Promise<OpenSkillMetaResult | null>
  getInitialTheme: () => Theme
  setTheme: (theme: Theme) => Promise<void>
  listAllowedPaths: () => Promise<AllowedPathRow[]>
  pickAndAddFolders: () => Promise<AllowedPathRow[]>
  revokeAllowedPath: (path: string) => Promise<AllowedPathRow[]>
  openExternal: (url: string) => Promise<void>
  onScanComplete: (callback: () => void) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: Api
  }
}
