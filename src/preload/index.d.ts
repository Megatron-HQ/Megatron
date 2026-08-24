import { ElectronAPI } from '@electron-toolkit/preload'
import type {
  AllowedPathRow,
  AppSection,
  OpenSkillMetaResult,
  OpenSkillResult,
  PluginActionInput,
  PluginActionResult,
  PluginDetailResult,
  PluginRow,
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
  listPlugins: () => Promise<PluginRow[]>
  getPluginDetail: (name: string, marketplace: string) => Promise<PluginDetailResult | null>
  enablePlugin: (input: PluginActionInput) => Promise<PluginActionResult>
  disablePlugin: (input: PluginActionInput) => Promise<PluginActionResult>
  updatePlugin: (input: PluginActionInput) => Promise<PluginActionResult>
  uninstallPlugin: (input: PluginActionInput) => Promise<PluginActionResult>
  getInitialSection: () => AppSection
  setLastSection: (section: AppSection) => Promise<void>
  onScanComplete: (callback: () => void) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: Api
  }
}
