import type Store from 'electron-store'
import type { Theme } from '../shared/ipc'

export type ThemeStore = Store<{ theme?: Theme }>

export function getStoredTheme(store: ThemeStore): Theme | undefined {
  return store.get('theme')
}

export function setStoredTheme(store: ThemeStore, theme: Theme): void {
  store.set('theme', theme)
}

export function resolveInitialTheme(store: ThemeStore, osPrefersDark: boolean): Theme {
  return getStoredTheme(store) ?? (osPrefersDark ? 'dark' : 'light')
}
