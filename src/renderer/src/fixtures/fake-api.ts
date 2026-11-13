// Installs a fake window.api when this module loads. The gallery imports it before anything else,
// because app modules read window.api while they load.
import type { Api } from '../../../shared/api'
import type { AppSection, ThemePreference } from '../../../shared/ipc'
import { skillsResult } from './data'

type Subscription =
  'onPluginUpdateProgress' | 'onScanStarted' | 'onScanComplete' | 'onScanProgress' | 'onUpdateState'
type Payload<K extends Subscription> = Parameters<Parameters<Api[K]>[0]>[0]

const listeners: { [K in Subscription]: Set<(payload: Payload<K>) => void> } = {
  onPluginUpdateProgress: new Set(),
  onScanStarted: new Set(),
  onScanComplete: new Set(),
  onScanProgress: new Set(),
  onUpdateState: new Set()
}

function subscribe<K extends Subscription>(
  name: K
): (callback: (payload: Payload<K>) => void) => () => void {
  return (callback) => {
    listeners[name].add(callback)
    return () => listeners[name].delete(callback)
  }
}

// Stands in for an event the main process would send.
export function emit<K extends Subscription>(name: K, payload: Payload<K>): void {
  for (const callback of [...listeners[name]]) callback(payload)
}

// Names of data calls a fixture made without giving them data. The gallery reports each one, so a
// screen never renders against data nobody chose.
export const unfaked: string[] = []

function needsData(name: keyof Api): () => Promise<never> {
  return () => {
    unfaked.push(name)
    return new Promise<never>(() => {})
  }
}

const done = async (): Promise<void> => {}
const query = new URLSearchParams(location.search)

window.api = {
  platform: query.get('platform') === 'win32' ? 'win32' : 'darwin',
  getInitialTheme: () => (query.get('theme') ?? 'system') as ThemePreference,
  getInitialSection: (): AppSection => 'skills',
  getInitialOnboarding: () => false,
  getVersion: () => '1.0.0',
  getHomePath: () => '/Users/fixture',

  listSkills: async () => skillsResult(),
  listAllowedPaths: async () => [],
  listProjects: async () => [],
  listPlugins: async () => [],
  getUpdateState: async () => ({ status: 'unsupported', version: null, autoCheck: true }),

  setTheme: done,
  setLastSection: done,
  setOnboardingDone: done,
  openExternal: done,
  revealDataFolder: done,
  checkForUpdates: done,
  installUpdate: done,
  setAutoUpdateCheck: done,
  openUpdateDownload: done,

  openSkill: needsData('openSkill'),
  openSkillMeta: needsData('openSkillMeta'),
  openSkillHistory: needsData('openSkillHistory'),
  pickAndAddFolders: needsData('pickAndAddFolders'),
  narrowAllowedPath: needsData('narrowAllowedPath'),
  revokeAllowedPath: needsData('revokeAllowedPath'),
  getPluginDetail: needsData('getPluginDetail'),
  enablePlugin: needsData('enablePlugin'),
  disablePlugin: needsData('disablePlugin'),
  updatePlugin: needsData('updatePlugin'),
  uninstallPlugin: needsData('uninstallPlugin'),
  getUsageOverview: needsData('getUsageOverview'),
  getUsageProjects: needsData('getUsageProjects'),
  linkUsageProjects: needsData('linkUsageProjects'),
  unlinkUsageProject: needsData('unlinkUsageProject'),
  getUsageCalendar: needsData('getUsageCalendar'),
  getUsageDay: needsData('getUsageDay'),
  getUsageSkillInvocations: needsData('getUsageSkillInvocations'),
  getContextBaseline: needsData('getContextBaseline'),
  getRecordedRequest: needsData('getRecordedRequest'),
  rescan: needsData('rescan'),

  onPluginUpdateProgress: subscribe('onPluginUpdateProgress'),
  onScanStarted: subscribe('onScanStarted'),
  onScanComplete: subscribe('onScanComplete'),
  onScanProgress: subscribe('onScanProgress'),
  onUpdateState: subscribe('onUpdateState')
}
