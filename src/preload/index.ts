import { contextBridge, ipcRenderer } from 'electron'
import type { Api } from '../shared/api'
import type { UsageProjectCatalog } from '../shared/usage-projects'
import type { WhatsNewAnchorId, WhatsNewInitialState } from '../shared/whats-new'
import {
  IPC_CHANNELS,
  type AllowedPathRow,
  type AppSection,
  type ClaudeFolderChoice,
  type ClaudeFolderStatus,
  type GrantChangeResult,
  type OpenSkillMetaResult,
  type OpenSkillResult,
  type McpActionResult,
  type McpConnectionCheckResult,
  type McpAddInput,
  type McpAddResult,
  type McpDeclarationRef,
  type McpServerDetail,
  type McpServerList,
  type McpUsageStats,
  type PluginActionInput,
  type PluginUpdateProgress,
  type PluginActionResult,
  type PluginDetailResult,
  type PluginRow,
  type SkillInvocationEntry,
  type SkillInvocationRecord,
  type SkillInvocationSliceInput,
  type SkillsListResult,
  type ThemePreference,
  type ScanActivity,
  type ScanFinished,
  type ScanProgress,
  type ScanSummary,
  type UsageOverview,
  type UsageCalendar,
  type UsageDayDetails,
  type ContextBaselineResult,
  type RecordedRequest,
  type UpdateState
} from '../shared/ipc'

// Custom APIs for renderer
const api = {
  platform: process.platform,
  listSkills: (): Promise<SkillsListResult> => ipcRenderer.invoke(IPC_CHANNELS.listSkills),
  openSkill: (id: number): Promise<OpenSkillResult | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.openSkill, id),
  openSkillMeta: (id: number): Promise<OpenSkillMetaResult | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.openSkillMeta, id),
  openSkillHistory: (id: number, offset = 0): Promise<SkillInvocationEntry[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.openSkillHistory, id, offset),
  getInitialTheme: (): ThemePreference => ipcRenderer.sendSync(IPC_CHANNELS.getInitialTheme),
  setTheme: (theme: ThemePreference): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.setTheme, theme),
  listAllowedPaths: (): Promise<AllowedPathRow[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.listAllowedPaths),
  listProjects: () => ipcRenderer.invoke(IPC_CHANNELS.listProjects),
  pickAndAddFolders: (target?: string): Promise<GrantChangeResult> =>
    target === undefined
      ? ipcRenderer.invoke(IPC_CHANNELS.pickAndAddFolders)
      : ipcRenderer.invoke(IPC_CHANNELS.pickAndAddFolders, target),
  listHiddenProjects: (): Promise<string[]> => ipcRenderer.invoke(IPC_CHANNELS.listHiddenProjects),
  hideProject: (path: string): Promise<string[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.hideProject, path),
  showProject: (path: string): Promise<string[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.showProject, path),
  narrowAllowedPath: (path: string): Promise<GrantChangeResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.narrowAllowedPath, path),
  revokeAllowedPath: (path: string): Promise<AllowedPathRow[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.revokeAllowedPath, path),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.openExternal, url),
  listPlugins: (): Promise<PluginRow[]> => ipcRenderer.invoke(IPC_CHANNELS.listPlugins),
  getPluginDetail: (name: string, marketplace: string): Promise<PluginDetailResult | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.getPluginDetail, name, marketplace),
  listMcpServers: (): Promise<McpServerList> => ipcRenderer.invoke(IPC_CHANNELS.listMcpServers),
  getMcpServerDetail: (id: string): Promise<McpServerDetail | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.getMcpServerDetail, id),
  revealMcpSource: (id: string, path: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC_CHANNELS.revealMcpSource, id, path),
  checkMcpConnections: (projectPath?: string): Promise<McpConnectionCheckResult> =>
    projectPath === undefined
      ? ipcRenderer.invoke(IPC_CHANNELS.checkMcpConnections)
      : ipcRenderer.invoke(IPC_CHANNELS.checkMcpConnections, projectPath),
  getInitialMcpCheckConfirmed: (): boolean =>
    ipcRenderer.sendSync(IPC_CHANNELS.getInitialMcpCheckConfirmed),
  confirmMcpCheck: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.confirmMcpCheck),
  removeMcpServer: (ref: McpDeclarationRef): Promise<McpActionResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.removeMcpServer, ref),
  addMcpServer: (input: McpAddInput): Promise<McpAddResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.addMcpServer, input),
  logoutMcpServer: (ref: McpDeclarationRef): Promise<McpActionResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.logoutMcpServer, ref),
  resetMcpProjectChoices: (projectPath: string): Promise<McpActionResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.resetMcpProjectChoices, projectPath),
  enablePlugin: (input: PluginActionInput): Promise<PluginActionResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.enablePlugin, input),
  disablePlugin: (input: PluginActionInput): Promise<PluginActionResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.disablePlugin, input),
  updatePlugin: (input: PluginActionInput): Promise<PluginActionResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.updatePlugin, input),
  uninstallPlugin: (input: PluginActionInput): Promise<PluginActionResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.uninstallPlugin, input),
  getUsageOverview: (): Promise<UsageOverview> => ipcRenderer.invoke(IPC_CHANNELS.usageOverview),
  getUsageProjects: (): Promise<UsageProjectCatalog> =>
    ipcRenderer.invoke(IPC_CHANNELS.usageProjects),
  linkUsageProjects: (input: {
    sourceId: string
    targetId: string
  }): Promise<UsageProjectCatalog> => ipcRenderer.invoke(IPC_CHANNELS.usageLinkProjects, input),
  unlinkUsageProject: (locationId: string): Promise<UsageProjectCatalog> =>
    ipcRenderer.invoke(IPC_CHANNELS.usageUnlinkProject, locationId),
  getUsageCalendar: (year: number): Promise<UsageCalendar> =>
    ipcRenderer.invoke(IPC_CHANNELS.usageCalendar, year),
  getUsageDay: (date: string): Promise<UsageDayDetails> =>
    ipcRenderer.invoke(IPC_CHANNELS.usageDay, date),
  getUsageSkillInvocations: (input: SkillInvocationSliceInput): Promise<SkillInvocationRecord[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.usageSkillInvocations, input),
  getUsageMcp: (): Promise<McpUsageStats> => ipcRenderer.invoke(IPC_CHANNELS.usageMcp),
  getContextBaseline: (): Promise<ContextBaselineResult> =>
    ipcRenderer.invoke(IPC_CHANNELS.usageContextBaseline),
  getInitialResidentTaxConfirmed: (): boolean =>
    ipcRenderer.sendSync(IPC_CHANNELS.getInitialResidentTaxConfirmed),
  confirmResidentTax: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.confirmResidentTax),
  getRecordedRequest: (): Promise<RecordedRequest | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.usageRecordedRequest),
  getInitialSection: (): AppSection => ipcRenderer.sendSync(IPC_CHANNELS.getInitialSection),
  setLastSection: (section: AppSection): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.setLastSection, section),
  getInitialOnboarding: (): boolean => ipcRenderer.sendSync(IPC_CHANNELS.getInitialOnboarding),
  setOnboardingDone: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.setOnboardingDone),
  getInitialWhatsNew: (): WhatsNewInitialState =>
    ipcRenderer.sendSync(IPC_CHANNELS.getInitialWhatsNew),
  markWhatsNewSeen: (): Promise<WhatsNewAnchorId[]> =>
    ipcRenderer.invoke(IPC_CHANNELS.markWhatsNewSeen),
  clearWhatsNewDot: (anchor: WhatsNewAnchorId): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.clearWhatsNewDot, anchor),
  rescan: (): Promise<ScanSummary> => ipcRenderer.invoke(IPC_CHANNELS.rescan),
  revealDataFolder: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.revealDataFolder),
  getVersion: (): string => ipcRenderer.sendSync(IPC_CHANNELS.getVersion),
  getHomePath: (): string => ipcRenderer.sendSync(IPC_CHANNELS.getHomePath),
  getUpdateState: (): Promise<UpdateState> => ipcRenderer.invoke(IPC_CHANNELS.getUpdateState),
  checkForUpdates: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.checkForUpdates),
  installUpdate: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.installUpdate),
  setAutoUpdateCheck: (enabled: boolean): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.setAutoUpdateCheck, enabled),
  getClaudeFolder: (): Promise<ClaudeFolderStatus> =>
    ipcRenderer.invoke(IPC_CHANNELS.getClaudeFolder),
  chooseClaudeFolder: (id: string): Promise<ClaudeFolderChoice> =>
    ipcRenderer.invoke(IPC_CHANNELS.chooseClaudeFolder, id),
  pickClaudeFolder: (): Promise<ClaudeFolderChoice> =>
    ipcRenderer.invoke(IPC_CHANNELS.pickClaudeFolder),
  onClaudeFolderState: (callback: (status: ClaudeFolderStatus) => void): (() => void) => {
    const listener = (_event: unknown, status: ClaudeFolderStatus): void => callback(status)
    ipcRenderer.on(IPC_CHANNELS.claudeFolderState, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.claudeFolderState, listener)
  },
  onPluginUpdateProgress: (callback: (progress: PluginUpdateProgress) => void): (() => void) => {
    const listener = (_event: unknown, progress: PluginUpdateProgress): void => callback(progress)
    ipcRenderer.on(IPC_CHANNELS.pluginUpdateProgress, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.pluginUpdateProgress, listener)
  },
  onScanStarted: (callback: (activity: ScanActivity) => void): (() => void) => {
    const listener = (_event: unknown, activity: ScanActivity): void => callback(activity)
    ipcRenderer.on(IPC_CHANNELS.scanStarted, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.scanStarted, listener)
  },
  onScanComplete: (callback: (finished: ScanFinished) => void): (() => void) => {
    const listener = (_event: unknown, finished: ScanFinished): void => callback(finished)
    ipcRenderer.on(IPC_CHANNELS.scanComplete, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.scanComplete, listener)
  },
  onScanProgress: (callback: (progress: ScanProgress) => void): (() => void) => {
    const listener = (_event: unknown, progress: ScanProgress): void => callback(progress)
    ipcRenderer.on(IPC_CHANNELS.scanProgress, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.scanProgress, listener)
  },
  onUpdateState: (callback: (state: UpdateState) => void): (() => void) => {
    const listener = (_event: unknown, state: UpdateState): void => callback(state)
    ipcRenderer.on(IPC_CHANNELS.updateState, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.updateState, listener)
  }
} satisfies Api

contextBridge.exposeInMainWorld('api', api)
