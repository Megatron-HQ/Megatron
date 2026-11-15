import type { UsageProjectCatalog } from './usage-projects'
import type { WhatsNewAnchorId, WhatsNewInitialState } from './whats-new'
import type {
  AllowedPathRow,
  AppSection,
  GrantChangeResult,
  OpenSkillMetaResult,
  OpenSkillResult,
  PluginActionInput,
  PluginUpdateProgress,
  PluginActionResult,
  PluginDetailResult,
  PluginRow,
  ProjectFolder,
  SkillInvocationEntry,
  SkillInvocationRecord,
  SkillInvocationSliceInput,
  SkillsListResult,
  ThemePreference,
  UsageOverview,
  UsageCalendar,
  UsageDayDetails,
  ContextBaselineResult,
  RecordedRequest,
  ScanActivity,
  ScanFinished,
  ScanProgress,
  ScanSummary,
  UpdateState
} from './ipc'

// The bridge the preload exposes as `window.api`, typed once so the preload's implementation and
// the renderer's view of it can't drift apart.
export interface Api {
  platform: NodeJS.Platform
  listSkills: () => Promise<SkillsListResult>
  openSkill: (id: number) => Promise<OpenSkillResult | null>
  openSkillMeta: (id: number) => Promise<OpenSkillMetaResult | null>
  openSkillHistory: (id: number, offset?: number) => Promise<SkillInvocationEntry[]>
  getInitialTheme: () => ThemePreference
  setTheme: (theme: ThemePreference) => Promise<void>
  listAllowedPaths: () => Promise<AllowedPathRow[]>
  listProjects: () => Promise<ProjectFolder[]>
  pickAndAddFolders: () => Promise<GrantChangeResult>
  narrowAllowedPath: (path: string) => Promise<GrantChangeResult>
  revokeAllowedPath: (path: string) => Promise<AllowedPathRow[]>
  openExternal: (url: string) => Promise<void>
  listPlugins: () => Promise<PluginRow[]>
  getPluginDetail: (name: string, marketplace: string) => Promise<PluginDetailResult | null>
  enablePlugin: (input: PluginActionInput) => Promise<PluginActionResult>
  disablePlugin: (input: PluginActionInput) => Promise<PluginActionResult>
  updatePlugin: (input: PluginActionInput) => Promise<PluginActionResult>
  uninstallPlugin: (input: PluginActionInput) => Promise<PluginActionResult>
  getUsageOverview: () => Promise<UsageOverview>
  getUsageProjects: () => Promise<UsageProjectCatalog>
  linkUsageProjects: (input: { sourceId: string; targetId: string }) => Promise<UsageProjectCatalog>
  unlinkUsageProject: (locationId: string) => Promise<UsageProjectCatalog>
  getUsageCalendar: (year: number) => Promise<UsageCalendar>
  getUsageDay: (date: string) => Promise<UsageDayDetails>
  getUsageSkillInvocations: (input: SkillInvocationSliceInput) => Promise<SkillInvocationRecord[]>
  getContextBaseline: () => Promise<ContextBaselineResult>
  getRecordedRequest: () => Promise<RecordedRequest | null>
  getInitialSection: () => AppSection
  setLastSection: (section: AppSection) => Promise<void>
  getInitialOnboarding: () => boolean
  setOnboardingDone: () => Promise<void>
  getInitialWhatsNew: () => WhatsNewInitialState
  // Resolves with the dots main now holds: a first showing leaves some, a replay keeps them.
  markWhatsNewSeen: () => Promise<WhatsNewAnchorId[]>
  clearWhatsNewDot: (anchor: WhatsNewAnchorId) => Promise<void>
  rescan: () => Promise<ScanSummary>
  revealDataFolder: () => Promise<void>
  getVersion: () => string
  getHomePath: () => string
  getUpdateState: () => Promise<UpdateState>
  checkForUpdates: () => Promise<void>
  installUpdate: () => Promise<void>
  setAutoUpdateCheck: (enabled: boolean) => Promise<void>
  onPluginUpdateProgress: (callback: (progress: PluginUpdateProgress) => void) => () => void
  onScanStarted: (callback: (activity: ScanActivity) => void) => () => void
  onScanComplete: (callback: (finished: ScanFinished) => void) => () => void
  onScanProgress: (callback: (progress: ScanProgress) => void) => () => void
  onUpdateState: (callback: (state: UpdateState) => void) => () => void
}
