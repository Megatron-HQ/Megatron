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
  autoUpdateCheck?: boolean
  onboardingDone?: boolean
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
