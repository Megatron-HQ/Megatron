import { homedir } from 'os'
import { join, resolve } from 'path'
import { allowedExistsSync, allowedReadFileSync, isPathAllowed } from '../permissions'

export type JsonReadStatus = 'ok' | 'missing' | 'unavailable' | 'invalid'

export interface JsonRead {
  status: JsonReadStatus
  value: unknown
}

// Shared by every scanner that reads a Claude Code JSON config file — degrades to a status
// rather than throwing, so one missing/malformed file never aborts a whole scan. Distinguishes
// a genuinely absent file ('missing', a definitive fact worth trusting) from one that exists but
// this scan can't read ('unavailable', e.g. a revoked grant — moved here unchanged from
// plugin-registry.ts, whose hasMarketplaceSnapshot logic depends on that distinction).
export function readJson(filePath: string): JsonRead {
  const contents = allowedReadFileSync(filePath)
  if (contents === null) {
    return { status: allowedExistsSync(filePath) ? 'unavailable' : 'missing', value: null }
  }
  try {
    return { status: 'ok', value: JSON.parse(contents.toString('utf8')) }
  } catch {
    return { status: 'invalid', value: null }
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const USER_SETTINGS_PATH = resolve(homedir(), '.claude', 'settings.json')

export interface PluginEnablement {
  // Plugin keys ('name@marketplace') resolving to `false`.
  disabled: Set<string>
  // false when a project root was asked for but is not readable, so the project's own
  // enabledPlugins could not be consulted and `disabled` is only the user-scope answer.
  known: boolean
}

function readEnabledPluginsFrom(settingsPath: string): Map<string, boolean> {
  const settings = readJson(settingsPath)
  const enabledPlugins = isRecord(settings.value) ? settings.value.enabledPlugins : null
  if (!isRecord(enabledPlugins)) return new Map()

  return new Map(
    Object.entries(enabledPlugins).filter(
      (entry): entry is [string, boolean] => typeof entry[1] === 'boolean'
    )
  )
}

// Resolves which plugins are switched off, for one install's scope.
//
// With no projectRoot: user scope only — a `user`-scope install is governed by
// ~/.claude/settings.json alone.
//
// With a projectRoot: merges local > project > user, the same precedence and file list
// readSkillOverrides below uses. A `project`/`local` install only ever loads inside that
// project, so its effective state is that project's fully resolved answer.
//
// An ungranted project root reads as 'missing', not 'unavailable' — isPathAllowed() gates
// allowedExistsSync() as well as the read itself — so readJson's status can't tell "no settings
// file" apart from "not allowed to look". The permission check is the only honest signal, and
// it's what `known: false` reports.
export function readPluginEnablement(
  projectRoot?: string,
  userSettingsPath: string = USER_SETTINGS_PATH
): PluginEnablement {
  const merged = readEnabledPluginsFrom(userSettingsPath)
  const known = projectRoot === undefined || isPathAllowed(projectRoot)

  if (projectRoot !== undefined && known) {
    for (const scopePath of projectScopeSettingsPaths(projectRoot)) {
      for (const [key, enabled] of readEnabledPluginsFrom(scopePath)) {
        merged.set(key, enabled)
      }
    }
  }

  const disabled = new Set(
    [...merged].filter(([, enabled]) => enabled === false).map(([key]) => key)
  )
  return { disabled, known }
}

function projectScopeSettingsPaths(projectRoot: string): string[] {
  return [
    join(projectRoot, '.claude', 'settings.json'),
    join(projectRoot, '.claude', 'settings.local.json')
  ]
}

function readSkillOverridesFrom(settingsPath: string): Map<string, string> {
  const settings = readJson(settingsPath)
  const overrides = isRecord(settings.value) ? settings.value.skillOverrides : null
  if (!isRecord(overrides)) return new Map()

  return new Map(
    Object.entries(overrides).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string'
    )
  )
}

// Skill name -> skillOverrides state ('on' | 'name-only' | 'user-invocable-only' | 'off').
//
// With no projectRoot: user scope only, for a Global skill — a Global skill's row has no
// project_root to anchor a project-level override to.
//
// With a projectRoot: merges local > project > user, since a Project skill's row is already
// anchored to that root and can genuinely only ever mean that project's own resolved state.
export function readSkillOverrides(
  projectRoot?: string,
  userSettingsPath: string = USER_SETTINGS_PATH
): Map<string, string> {
  const merged = readSkillOverridesFrom(userSettingsPath)
  if (!projectRoot) return merged

  for (const scopePath of projectScopeSettingsPaths(projectRoot)) {
    for (const [name, value] of readSkillOverridesFrom(scopePath)) {
      merged.set(name, value)
    }
  }
  return merged
}
