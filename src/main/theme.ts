import type Store from 'electron-store'
import type { UsageProjectLocation } from '../shared/usage-projects'
import { listAllowedPaths } from './folder-grants'
import {
  APP_SECTIONS,
  type AllowedPathRow,
  type AppSection,
  type ProjectFolder,
  type ThemePreference
} from '../shared/ipc'

export type ThemeStore = Store<{
  theme?: ThemePreference
  lastSection?: AppSection
  projectFolders?: ProjectFolder[]
  usageProjects?: UsageProjectLocation[]
  grantedFolders?: AllowedPathRow[]
  // Folders the user hid from Megatron; see hidden-projects.ts.
  hiddenProjects?: string[]
  autoUpdateCheck?: boolean
  onboardingDone?: boolean
  // The user read once what the MCP connection check starts (docs/mcp-servers.md, Live check).
  mcpCheckConfirmed?: boolean
  whatsNewSeenVersion?: string
  whatsNewDots?: { anchors: string[]; expiresAt: string }
  // A path, or null for Claude Code's default (~/.claude); absent when never chosen.
  claudeConfigDir?: string | null
  // An offline launch can find the same profile's caches until the configured path returns.
  claudeConfigBinding?: { directory: string; canonicalDirectory: string }
}>

export function getStoredTheme(store: ThemeStore): ThemePreference | undefined {
  return store.get('theme')
}

export function setStoredTheme(store: ThemeStore, theme: ThemePreference): void {
  store.set('theme', theme)
}

export function resolveInitialTheme(store: ThemeStore): ThemePreference {
  return getStoredTheme(store) ?? 'system'
}

export function setStoredSection(store: ThemeStore, section: AppSection): void {
  store.set('lastSection', section)
}

export function resolveInitialSection(store: ThemeStore): AppSection {
  const stored = store.get('lastSection')
  return APP_SECTIONS.includes(stored as AppSection) ? (stored as AppSection) : 'skills'
}

// Onboarding exists to get folder access, so a user who already granted folders (an upgrade
// from before onboarding shipped) never needs it, even if they later revoke every grant.
export function resolveOnboarding(store: ThemeStore): boolean {
  if (store.get('onboardingDone') === true) return false
  if (listAllowedPaths(store).length === 0) return true
  markOnboardingDone(store)
  return false
}

export function markOnboardingDone(store: ThemeStore): void {
  store.set('onboardingDone', true)
}
