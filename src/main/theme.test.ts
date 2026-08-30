import Store from 'electron-store'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  getStoredTheme,
  resolveInitialSection,
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
})
