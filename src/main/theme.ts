import type Store from 'electron-store'
import type { AppSection, ThemePreference } from '../shared/ipc'

export type ThemeStore = Store<{ theme?: ThemePreference; lastSection?: AppSection }>

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
  return store.get('lastSection') ?? 'skills'
}
