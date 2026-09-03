import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { grantPath, resetGrantedPaths } from '../permissions'
import { readPluginEnablement, readSkillOverrides } from './claude-settings'

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

function writeProjectSettings(projectRoot: string, fileName: string, content: unknown): void {
  mkdirSync(join(projectRoot, '.claude'), { recursive: true })
  writeFileSync(join(projectRoot, '.claude', fileName), JSON.stringify(content))
}

describe('readPluginEnablement', () => {
  it('returns the keys whose enabledPlugins entry is false', () => {
    writeUserSettings({
      enabledPlugins: { 'ponytail@ponytail': true, 'impeccable@impeccable': false }
    })

    expect(readPluginEnablement(undefined, userSettingsPath).disabled).toEqual(
      new Set(['impeccable@impeccable'])
    )
  })

  it('returns an empty set when the settings file is missing', () => {
    expect(readPluginEnablement(undefined, userSettingsPath).disabled).toEqual(new Set())
  })

  it('returns an empty set when the settings file is invalid JSON', () => {
    writeFileSync(userSettingsPath, '{not json')
    expect(readPluginEnablement(undefined, userSettingsPath).disabled).toEqual(new Set())
  })

  it('returns an empty set when enabledPlugins is absent', () => {
    writeUserSettings({ model: 'opusplan' })
    expect(readPluginEnablement(undefined, userSettingsPath).disabled).toEqual(new Set())
  })

  it("lets a project's enabledPlugins re-enable a plugin the user scope disabled", () => {
    writeUserSettings({ enabledPlugins: { 'plugin-a@market-1': false } })
    const projectRoot = join(tmpDir, 'repo')
    writeProjectSettings(projectRoot, 'settings.json', {
      enabledPlugins: { 'plugin-a@market-1': true }
    })

    expect(readPluginEnablement(projectRoot, userSettingsPath).disabled).toEqual(new Set())
  })

  it("lets a project's enabledPlugins disable a plugin the user scope left enabled", () => {
    writeUserSettings({ enabledPlugins: { 'plugin-a@market-1': true } })
    const projectRoot = join(tmpDir, 'repo')
    writeProjectSettings(projectRoot, 'settings.json', {
      enabledPlugins: { 'plugin-a@market-1': false }
    })

    expect(readPluginEnablement(projectRoot, userSettingsPath).disabled).toEqual(
      new Set(['plugin-a@market-1'])
    )
  })

  it('merges local scope over project scope over user scope', () => {
    writeUserSettings({ enabledPlugins: { 'plugin-a@market-1': true } })
    const projectRoot = join(tmpDir, 'repo')
    writeProjectSettings(projectRoot, 'settings.json', {
      enabledPlugins: { 'plugin-a@market-1': true }
    })
    writeProjectSettings(projectRoot, 'settings.local.json', {
      enabledPlugins: { 'plugin-a@market-1': false }
    })

    expect(readPluginEnablement(projectRoot, userSettingsPath).disabled).toEqual(
      new Set(['plugin-a@market-1'])
    )
  })

  it('keeps user-scope entries a project does not mention', () => {
    writeUserSettings({
      enabledPlugins: { 'plugin-a@market-1': false, 'plugin-b@market-1': false }
    })
    const projectRoot = join(tmpDir, 'repo')
    writeProjectSettings(projectRoot, 'settings.json', {
      enabledPlugins: { 'plugin-a@market-1': true }
    })

    expect(readPluginEnablement(projectRoot, userSettingsPath).disabled).toEqual(
      new Set(['plugin-b@market-1'])
    )
  })

  it('reports known when there is no project root to consult', () => {
    writeUserSettings({ enabledPlugins: {} })

    expect(readPluginEnablement(undefined, userSettingsPath).known).toBe(true)
  })

  it('reports known for a granted project root with no settings files of its own', () => {
    const projectRoot = join(tmpDir, 'repo-with-no-settings')
    mkdirSync(projectRoot, { recursive: true })

    expect(readPluginEnablement(projectRoot, userSettingsPath).known).toBe(true)
  })

  // An ungranted root reads as 'missing' rather than 'unavailable' (isPathAllowed gates
  // allowedExistsSync too), so the permission check is the only signal that separates
  // "this project has no plugin settings" from "we were not allowed to look".
  it('reports not-known for a project root that has not been granted', () => {
    const ungrantedRoot = mkdtempSync(join(tmpdir(), 'megatron-ungranted-'))
    try {
      writeProjectSettings(ungrantedRoot, 'settings.json', {
        enabledPlugins: { 'plugin-a@market-1': false }
      })

      expect(readPluginEnablement(ungrantedRoot, userSettingsPath).known).toBe(false)
    } finally {
      rmSync(ungrantedRoot, { recursive: true, force: true })
    }
  })

  it('falls back to the user-scope answer for an ungranted project root', () => {
    const ungrantedRoot = mkdtempSync(join(tmpdir(), 'megatron-ungranted-'))
    try {
      writeUserSettings({ enabledPlugins: { 'plugin-a@market-1': false } })
      writeProjectSettings(ungrantedRoot, 'settings.json', {
        enabledPlugins: { 'plugin-a@market-1': true }
      })

      expect(readPluginEnablement(ungrantedRoot, userSettingsPath).disabled).toEqual(
        new Set(['plugin-a@market-1'])
      )
    } finally {
      rmSync(ungrantedRoot, { recursive: true, force: true })
    }
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
