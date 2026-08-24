import type Store from 'electron-store'
import type { AppSection, Theme } from '../shared/ipc'

export type ThemeStore = Store<{ theme?: Theme; lastSection?: AppSection }>

export function getStoredTheme(store: ThemeStore): Theme | undefined {
  return store.get('theme')
}

export function setStoredTheme(store: ThemeStore, theme: Theme): void {
  store.set('theme', theme)
}

export function resolveInitialTheme(store: ThemeStore, osPrefersDark: boolean): Theme {
  return getStoredTheme(store) ?? (osPrefersDark ? 'dark' : 'light')
}

export function setStoredSection(store: ThemeStore, section: AppSection): void {
  store.set('lastSection', section)
}

export function resolveInitialSection(store: ThemeStore): AppSection {
  return store.get('lastSection') ?? 'skills'
}
