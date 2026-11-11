import Store from 'electron-store'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  getStoredTheme,
  markOnboardingDone,
  resolveInitialSection,
  resolveOnboarding,
  setStoredSection,
  setStoredTheme,
  resolveInitialTheme,
  type ThemeStore
} from './theme'

let tempDir: string
let store: ThemeStore

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'megatron-theme-test-'))
  store = new Store({ name: 'preferences', cwd: tempDir })
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

describe('getStoredTheme', () => {
  it('returns undefined when no theme has been stored', () => {
    expect(getStoredTheme(store)).toBeUndefined()
  })

  it('returns the previously stored theme', () => {
    setStoredTheme(store, 'dark')
    expect(getStoredTheme(store)).toBe('dark')
  })

  it('returns the stored system preference', () => {
    setStoredTheme(store, 'system')
    expect(getStoredTheme(store)).toBe('system')
  })
})

describe('resolveInitialTheme', () => {
  it('prefers the stored override over the OS preference', () => {
    setStoredTheme(store, 'light')
    expect(resolveInitialTheme(store)).toBe('light')
  })

  it('defaults to the system preference when nothing is stored', () => {
    expect(resolveInitialTheme(store)).toBe('system')
  })
})

describe('resolveInitialSection', () => {
  it('defaults to skills when nothing has been stored', () => {
    expect(resolveInitialSection(store)).toBe('skills')
  })

  it('returns the previously stored section', () => {
    setStoredSection(store, 'plugins')
    expect(resolveInitialSection(store)).toBe('plugins')
  })

  it('round-trips the usage section', () => {
    setStoredSection(store, 'usage')
    expect(resolveInitialSection(store)).toBe('usage')
  })

  it('falls back to skills when the stored value is not a known section', () => {
    store.set('lastSection', 'no-such-section' as never)
    expect(resolveInitialSection(store)).toBe('skills')
  })
})

describe('resolveOnboarding', () => {
  const grant = (): void =>
    store.set('grantedFolders', [
      { path: join(tempDir, 'repo'), granted_at: '2026-11-01T00:00:00.000Z' }
    ])

  it('shows onboarding on a fresh install, and again if it was quit before finishing', () => {
    expect(resolveOnboarding(store)).toBe(true)
    expect(resolveOnboarding(store)).toBe(true)
  })

  it('skips onboarding once it has been finished', () => {
    markOnboardingDone(store)
    expect(resolveOnboarding(store)).toBe(false)
  })

  it('skips an upgrading user who already granted folders, for good', () => {
    grant()
    expect(resolveOnboarding(store)).toBe(false)
    store.set('grantedFolders', [])
    expect(resolveOnboarding(store)).toBe(false)
  })

  it('ignores malformed grants when deciding the user is already set up', () => {
    store.set('grantedFolders', [{ path: 'relative/repo', granted_at: '2026-11-01' }] as never)
    expect(resolveOnboarding(store)).toBe(true)
  })
})
