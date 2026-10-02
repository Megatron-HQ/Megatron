import type {
  AllowedPathRow,
  AppSection,
  OpenSkillMetaResult,
  OpenSkillResult,
  PluginActionInput,
  PluginActionResult,
  PluginDetailResult,
  PluginRow,
  SkillInvocationEntry,
  SkillInvocationRecord,
  SkillInvocationSliceInput,
  SkillsListResult,
  ThemePreference,
  UsageOverview,
  ScanSummary
} from '../shared/ipc'

interface Api {
  platform: NodeJS.Platform
  listSkills: () => Promise<SkillsListResult>
  openSkill: (id: number) => Promise<OpenSkillResult | null>
  openSkillMeta: (id: number) => Promise<OpenSkillMetaResult | null>
  openSkillHistory: (id: number) => Promise<SkillInvocationEntry[]>
  getInitialTheme: () => ThemePreference
  setTheme: (theme: ThemePreference) => Promise<void>
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
  getUsageOverview: () => Promise<UsageOverview>
  getUsageSkillInvocations: (input: SkillInvocationSliceInput) => Promise<SkillInvocationRecord[]>
  getInitialSection: () => AppSection
  setLastSection: (section: AppSection) => Promise<void>
  rescan: () => Promise<ScanSummary>
  revealDataFolder: () => Promise<void>
  getVersion: () => string
  onScanComplete: (callback: () => void) => () => void
}

declare global {
  interface Window {
    api: Api
  }
}
