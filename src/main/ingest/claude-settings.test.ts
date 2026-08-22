import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { grantPath, resetGrantedPaths } from '../permissions'
import { readDisabledPlugins, readSkillOverrides } from './claude-settings'

let tmpDir: string
let userSettingsPath: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'megatron-settings-test-'))
  userSettingsPath = join(tmpDir, 'user-settings.json')
  grantPath(tmpDir)
})

afterEach(() => {
  resetGrantedPaths()
  rmSync(tmpDir, { recursive: true, force: true })
})

function writeUserSettings(content: unknown): void {
  writeFileSync(userSettingsPath, JSON.stringify(content))
}

describe('readDisabledPlugins', () => {
  it('returns the keys whose enabledPlugins entry is false', () => {
    writeUserSettings({
      enabledPlugins: { 'ponytail@ponytail': true, 'impeccable@impeccable': false }
    })

    expect(readDisabledPlugins(userSettingsPath)).toEqual(new Set(['impeccable@impeccable']))
  })

  it('returns an empty set when the settings file is missing', () => {
    expect(readDisabledPlugins(userSettingsPath)).toEqual(new Set())
  })

  it('returns an empty set when the settings file is invalid JSON', () => {
    writeFileSync(userSettingsPath, '{not json')
    expect(readDisabledPlugins(userSettingsPath)).toEqual(new Set())
  })

  it('returns an empty set when enabledPlugins is absent', () => {
    writeUserSettings({ model: 'opusplan' })
    expect(readDisabledPlugins(userSettingsPath)).toEqual(new Set())
  })
})

describe('readSkillOverrides', () => {
  it('reads user-scope overrides when no projectRoot is given', () => {
    writeUserSettings({ skillOverrides: { 'my-skill': 'off' } })

    expect(readSkillOverrides(undefined, userSettingsPath)).toEqual(new Map([['my-skill', 'off']]))
  })

  it('returns an empty map when skillOverrides is absent', () => {
    writeUserSettings({ model: 'opusplan' })
    expect(readSkillOverrides(undefined, userSettingsPath)).toEqual(new Map())
  })

  it('merges project scope over user scope for a given projectRoot', () => {
    writeUserSettings({ skillOverrides: { 'user-only-skill': 'off', shared: 'user' } })
    const projectRoot = join(tmpDir, 'repo')
    mkdirSync(join(projectRoot, '.claude'), { recursive: true })
    writeFileSync(
      join(projectRoot, '.claude', 'settings.json'),
      JSON.stringify({ skillOverrides: { shared: 'project' } })
    )

    expect(readSkillOverrides(projectRoot, userSettingsPath)).toEqual(
      new Map([
        ['user-only-skill', 'off'],
        ['shared', 'project']
      ])
    )
  })

  it('merges local scope over project scope over user scope', () => {
    writeUserSettings({ skillOverrides: { shared: 'user' } })
    const projectRoot = join(tmpDir, 'repo')
    mkdirSync(join(projectRoot, '.claude'), { recursive: true })
    writeFileSync(
      join(projectRoot, '.claude', 'settings.json'),
      JSON.stringify({ skillOverrides: { shared: 'project' } })
    )
    writeFileSync(
      join(projectRoot, '.claude', 'settings.local.json'),
      JSON.stringify({ skillOverrides: { shared: 'off' } })
    )

    expect(readSkillOverrides(projectRoot, userSettingsPath)).toEqual(new Map([['shared', 'off']]))
  })

  it('ignores a projectRoot with no settings files, falling back to user scope', () => {
    writeUserSettings({ skillOverrides: { 'my-skill': 'off' } })
    const projectRoot = join(tmpDir, 'repo-with-no-settings')
    mkdirSync(projectRoot, { recursive: true })

    expect(readSkillOverrides(projectRoot, userSettingsPath)).toEqual(
      new Map([['my-skill', 'off']])
    )
  })
})
