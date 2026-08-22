import { homedir } from 'os'
import { join, resolve } from 'path'
import { allowedExistsSync, allowedReadFileSync } from '../permissions'

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

// Plugin keys ('name@marketplace') whose enabledPlugins entry is `false`. User scope only:
// a plugin skill's row has no project_root (docs/skill-scanner.md), so a project-level
// enabledPlugins override can't be represented without a second scan dimension — out of scope,
// see CLAUDE.md's Locked decisions.
export function readDisabledPlugins(userSettingsPath: string = USER_SETTINGS_PATH): Set<string> {
  const settings = readJson(userSettingsPath)
  const enabledPlugins = isRecord(settings.value) ? settings.value.enabledPlugins : null
  if (!isRecord(enabledPlugins)) return new Set()

  return new Set(
    Object.entries(enabledPlugins)
      .filter(([, enabled]) => enabled === false)
      .map(([key]) => key)
  )
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
// With no projectRoot: user scope only, for a Global skill — same one-row constraint as
// readDisabledPlugins above.
//
// With a projectRoot: merges local > project > user, since a Project skill's row is already
// anchored to that root and can genuinely only ever mean that project's own resolved state.
export function readSkillOverrides(
  projectRoot?: string,
  userSettingsPath: string = USER_SETTINGS_PATH
): Map<string, string> {
  const merged = readSkillOverridesFrom(userSettingsPath)
  if (!projectRoot) return merged

  for (const scopePath of [
    join(projectRoot, '.claude', 'settings.json'),
    join(projectRoot, '.claude', 'settings.local.json')
  ]) {
    for (const [name, value] of readSkillOverridesFrom(scopePath)) {
      merged.set(name, value)
    }
  }
  return merged
}
