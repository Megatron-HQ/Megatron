import type Database from 'better-sqlite3'
import { homedir } from 'os'
import { join, resolve } from 'path'
import { writeSkillScan, writeSkillScanAuthoritative, type SkillScanRow } from '../db/queries'
import {
  allowedExistsSync,
  allowedReadFileSync,
  isPathAllowed,
  readAllowedDirectory
} from '../permissions'
import { isRecord, readJson, readPluginEnablement } from './claude-settings'
import { parseSkillDirectory } from './skill-parser'
import { isSemanticVersion } from '../../shared/version'

interface PluginInstallEntry {
  scope?: unknown
  installPath?: unknown
  projectPath?: unknown
  version?: unknown
  installedAt?: unknown
  lastUpdated?: unknown
  gitCommitSha?: unknown
}

interface MarketplaceEntry {
  source?: { repo?: unknown }
  installLocation?: unknown
}

interface MarketplacePluginManifestEntry {
  name?: unknown
  version?: unknown
  source?: unknown
}

function shortCommitSha(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const sha = value.trim().toLowerCase()
  return /^[0-9a-f]{12,}$/.test(sha) ? sha.slice(0, 12) : null
}

function getMarketplaceHeadSha(installLocation: string): string | null {
  const gcsShaBytes = allowedReadFileSync(join(installLocation, '.gcs-sha'))
  if (gcsShaBytes) {
    const sha = gcsShaBytes.toString('utf8').trim().toLowerCase()
    if (/^[0-9a-f]{12,}$/.test(sha)) {
      return sha.slice(0, 12)
    }
  }

  const gitHeadBytes = allowedReadFileSync(join(installLocation, '.git', 'HEAD'))
  if (gitHeadBytes) {
    const headContent = gitHeadBytes.toString('utf8').trim()
    if (headContent.startsWith('ref: ')) {
      const refRel = headContent.slice(5).trim()
      const refBytes = allowedReadFileSync(join(installLocation, '.git', refRel))
      if (refBytes) {
        const refSha = refBytes.toString('utf8').trim().toLowerCase()
        if (/^[0-9a-f]{12,}$/.test(refSha)) {
          return refSha.slice(0, 12)
        }
      }
      const packedBytes = allowedReadFileSync(join(installLocation, '.git', 'packed-refs'))
      if (packedBytes) {
        const packed = packedBytes.toString('utf8')
        for (const line of packed.split('\n')) {
          const trimmed = line.trim()
          if (trimmed.endsWith(' ' + refRel)) {
            const sha = trimmed.split(' ')[0].trim().toLowerCase()
            if (/^[0-9a-f]{12,}$/.test(sha)) {
              return sha.slice(0, 12)
            }
          }
        }
      }
    } else if (/^[0-9a-f]{12,}$/.test(headContent.toLowerCase())) {
      return headContent.toLowerCase().slice(0, 12)
    }
  }

  return null
}

function resolveMarketplaceAvailableVersion(
  marketplaceInstallLocation: string,
  pluginName: string
): string | null {
  let manifest = readJson(join(marketplaceInstallLocation, '.claude-plugin', 'marketplace.json'))
  if (manifest.status !== 'ok') {
    manifest = readJson(join(marketplaceInstallLocation, 'marketplace.json'))
  }
  if (manifest.status !== 'ok' || !isRecord(manifest.value)) return null

  const pluginsRaw = manifest.value.plugins
  if (!Array.isArray(pluginsRaw)) return null

  const entryRaw = pluginsRaw.find((p) => isRecord(p) && p.name === pluginName)
  if (!isRecord(entryRaw)) return null

  const entry = entryRaw as MarketplacePluginManifestEntry

  // 1. Direct version in marketplace manifest
  if (typeof entry.version === 'string' && entry.version.trim().length > 0) {
    return entry.version.trim()
  }

  // 2. Local source path in marketplace
  if (typeof entry.source === 'string') {
    const p1 = readJson(
      join(marketplaceInstallLocation, entry.source, '.claude-plugin', 'plugin.json')
    )
    if (p1.status === 'ok' && isRecord(p1.value) && typeof p1.value.version === 'string') {
      return p1.value.version.trim()
    }
    const p2 = readJson(join(marketplaceInstallLocation, entry.source, 'plugin.json'))
    if (p2.status === 'ok' && isRecord(p2.value) && typeof p2.value.version === 'string') {
      return p2.value.version.trim()
    }

    return getMarketplaceHeadSha(marketplaceInstallLocation)
  }

  // 3. Object source (git-subdir, url, etc.)
  if (isRecord(entry.source)) {
    const src = entry.source as Record<string, unknown>
    const sha = shortCommitSha(src.sha)
    if (sha) return sha
    if (typeof src.ref === 'string' && isSemanticVersion(src.ref)) return src.ref.trim()
  }

  return null
}

// One normalized install from installed_plugins.json, with its enablement already resolved
// against its own scope. Built for every entry of a plugin key before any of them is written,
// because a skill row's disabled state depends on all of them (see runScan below).
interface NormalizedInstall {
  scope: 'user' | 'project' | 'local'
  installPath: string
  projectPath: string
  version: string
  installedAt: string | null
  lastUpdated: string | null
  gitCommitSha: string | null
  disabledReason: string | null
  availableVersion: string | null
}

// Mirrors the table's primary key, which install_path alone cannot: Claude Code's cache path is
// version-addressed, so one plugin at one version installed for two scopes — or for two
// different projects — reports a single installPath for every one of those installs.
function registryKey(
  name: string,
  marketplace: string,
  scope: string,
  installPath: string,
  projectPath: string
): string {
  return JSON.stringify([name, marketplace, scope, installPath, projectPath])
}

function splitPluginKey(key: string): { name: string; marketplace: string } {
  const atIndex = key.lastIndexOf('@')
  return { name: key.slice(0, atIndex), marketplace: key.slice(atIndex + 1) }
}

// Reads the plugin's own `.claude-plugin/plugin.json` and, if it declares a hooks manifest
// (e.g. `"hooks": "./hooks/claude-codex-hooks.json"`), resolves and reads that file too, so
// Megatron can tell "never invoked as a Skill" apart from "runs every turn via a hook" — a plugin
// that's active but was never routed through the Skill tool would otherwise look identically dead.
// Degrades to null on any missing/invalid manifest rather than aborting the plugin's whole scan.
function readPluginHookEvents(installPath: string): string | null {
  const manifest = readJson(join(installPath, '.claude-plugin', 'plugin.json'))
  if (manifest.status !== 'ok' || !isRecord(manifest.value)) return null

  const hooksRelPath = manifest.value.hooks
  if (typeof hooksRelPath !== 'string' || hooksRelPath.length === 0) return null

  const hooksManifest = readJson(resolve(installPath, hooksRelPath))
  if (hooksManifest.status !== 'ok' || !isRecord(hooksManifest.value)) return null

  const events = hooksManifest.value.hooks
  if (!isRecord(events)) return null

  const eventNames = Object.keys(events)
  return eventNames.length > 0 ? JSON.stringify(eventNames) : null
}

export function scanPluginRegistry(
  db: Database.Database,
  pluginsDir: string = resolve(homedir(), '.claude', 'plugins'),
  userSettingsPath?: string
): void {
  const pluginsDirectory = readAllowedDirectory(pluginsDir)
  if (pluginsDirectory.status === 'unavailable') return

  // One resolution per distinct project root (plus '' for user scope) rather than per install —
  // a project with several plugins would otherwise re-read the same two settings files each time.
  const enablementCache = new Map<string, Set<string>>()
  function disabledPluginsFor(projectPath: string): Set<string> {
    const cached = enablementCache.get(projectPath)
    if (cached) return cached

    const enablement = readPluginEnablement(
      projectPath === '' ? undefined : projectPath,
      userSettingsPath
    )
    // An unreadable project root means we genuinely don't know; falling back to the user-scope
    // answer would stamp a state this project never asked for. Report nothing disabled and let
    // listPlugins mark the install's enablement unknown (see queries.ts).
    const resolved = enablement.known ? enablement.disabled : new Set<string>()
    enablementCache.set(projectPath, resolved)
    return resolved
  }

  const installed = readJson(join(pluginsDir, 'installed_plugins.json'))
  if (installed.status === 'unavailable' || installed.status === 'invalid') return

  const marketplaces = readJson(join(pluginsDir, 'known_marketplaces.json'))

  const pluginsMap =
    isRecord(installed.value) && isRecord(installed.value.plugins)
      ? (installed.value.plugins as Record<string, unknown>)
      : {}
  const marketplaceEntries = isRecord(marketplaces.value)
    ? (marketplaces.value as Record<string, MarketplaceEntry>)
    : {}
  const hasMarketplaceSnapshot = marketplaces.status === 'ok' || marketplaces.status === 'missing'

  const upsertRegistry = db.prepare(`
    INSERT INTO plugin_registry
      (name, marketplace, marketplace_repo, installed_version, scope, install_path, last_scanned_at,
       installed_at, last_updated, git_commit_sha, disabled_reason, available_version, project_path)
    VALUES (@name, @marketplace, @marketplace_repo, @installed_version, @scope, @install_path, @last_scanned_at,
       @installed_at, @last_updated, @git_commit_sha, @disabled_reason, @available_version, @project_path)
    ON CONFLICT(name, marketplace, scope, install_path, project_path) DO UPDATE SET
      marketplace_repo = CASE
        WHEN @has_marketplace_snapshot = 1 THEN excluded.marketplace_repo
        ELSE plugin_registry.marketplace_repo
      END,
      installed_version = excluded.installed_version,
      scope = excluded.scope,
      install_path = excluded.install_path,
      last_scanned_at = excluded.last_scanned_at,
      installed_at = excluded.installed_at,
      last_updated = excluded.last_updated,
      git_commit_sha = excluded.git_commit_sha,
      disabled_reason = excluded.disabled_reason,
      available_version = excluded.available_version
  `)

  const availableVersionsCache = new Map<string, string | null>()
  function getAvailableVersion(marketplace: string, name: string): string | null {
    const cacheKey = `${marketplace}:${name}`
    if (availableVersionsCache.has(cacheKey)) return availableVersionsCache.get(cacheKey)!

    const mpConfig = marketplaceEntries[marketplace]
    const loc = typeof mpConfig?.installLocation === 'string' ? mpConfig.installLocation : null
    if (!loc || !isPathAllowed(loc)) {
      availableVersionsCache.set(cacheKey, null)
      return null
    }

    const ver = resolveMarketplaceAvailableVersion(loc, name)
    availableVersionsCache.set(cacheKey, ver)
    return ver
  }

  const runScan = db.transaction(() => {
    const seenRegistryKeys = new Set<string>()
    const skillRows: SkillScanRow[] = []
    const readableSkillRoots: string[] = []
    let pluginSkillScanIsAuthoritative = true
    const now = new Date().toISOString()

    for (const [key, entriesRaw] of Object.entries(pluginsMap)) {
      const { name, marketplace } = splitPluginKey(key)
      const marketplaceRepo = marketplaceEntries[marketplace]?.source?.repo
      const repo = typeof marketplaceRepo === 'string' ? marketplaceRepo : null
      const availableVersion = getAvailableVersion(marketplace, name)

      const entries = Array.isArray(entriesRaw) ? entriesRaw : []
      const installs: NormalizedInstall[] = []
      for (const entryRaw of entries) {
        if (!isRecord(entryRaw)) continue
        const entry = entryRaw as PluginInstallEntry

        const scope = entry.scope
        if (scope !== 'user' && scope !== 'project' && scope !== 'local') continue

        const installPath = typeof entry.installPath === 'string' ? entry.installPath : null
        if (installPath === null) continue

        // A project/local entry written without a projectPath still describes a real, installed
        // plugin — record it without project context rather than dropping it.
        const projectPath =
          scope !== 'user' && typeof entry.projectPath === 'string' ? entry.projectPath : ''

        installs.push({
          scope,
          installPath,
          projectPath,
          version: typeof entry.version === 'string' ? entry.version : 'unknown',
          installedAt: typeof entry.installedAt === 'string' ? entry.installedAt : null,
          lastUpdated: typeof entry.lastUpdated === 'string' ? entry.lastUpdated : null,
          gitCommitSha: typeof entry.gitCommitSha === 'string' ? entry.gitCommitSha : null,
          disabledReason: disabledPluginsFor(projectPath).has(`${name}@${marketplace}`)
            ? 'plugin'
            : null,
          availableVersion
        })
      }

      // Two installs at the same version share one installPath, therefore one set of skills rows,
      // so a skill's disabled state can't follow a single install. It is disabled only when every
      // install of its plugin is — "still loads somewhere" is the honest reading of a split.
      const skillDisabledReason =
        installs.length > 0 && installs.every((install) => install.disabledReason !== null)
          ? 'plugin'
          : null

      for (const install of installs) {
        const { installPath } = install

        upsertRegistry.run({
          name,
          marketplace,
          marketplace_repo: repo,
          installed_version: install.version,
          scope: install.scope,
          install_path: installPath,
          last_scanned_at: now,
          has_marketplace_snapshot: hasMarketplaceSnapshot ? 1 : 0,
          installed_at: install.installedAt,
          last_updated: install.lastUpdated,
          git_commit_sha: install.gitCommitSha,
          disabled_reason: install.disabledReason,
          available_version: install.availableVersion,
          project_path: install.projectPath
        })
        seenRegistryKeys.add(
          registryKey(name, marketplace, install.scope, installPath, install.projectPath)
        )

        const hookEvents = readPluginHookEvents(installPath)

        const skillsDir = join(installPath, 'skills')
        const skillsDirectory = readAllowedDirectory(skillsDir)
        if (skillsDirectory.status === 'unavailable') {
          pluginSkillScanIsAuthoritative = false
          continue
        }
        readableSkillRoots.push(skillsDir)

        for (const entryName of skillsDirectory.entries) {
          const dirPath = join(skillsDir, entryName)
          if (!allowedExistsSync(join(dirPath, 'SKILL.md'))) continue

          const parsed = parseSkillDirectory(dirPath)
          skillRows.push({
            // Claude Code invokes and records a plugin skill under this namespaced form
            // (e.g. `impeccable:impeccable`), never the bare SKILL.md name — skill_invocations
            // joins on this text with no FK (docs/data-model.md), so a bare name here silently
            // orphans every invocation of every plugin skill from its usage stats.
            name: `${name}:${parsed.name}`,
            source_path: dirPath,
            plugin_name: `${name}@${marketplace}`,
            description: parsed.description,
            est_listing_tokens: parsed.est_listing_tokens,
            est_body_tokens: parsed.est_body_tokens,
            license: parsed.license,
            metadata_json: parsed.metadata_json,
            created_at: null,
            modified_at: null,
            hook_events: hookEvents,
            disabled_reason: skillDisabledReason,
            // Frontmatter only — plugin skills already ignore skillOverrides (see
            // docs/skill-scanner.md), and their rows have no project_root to scope it.
            model_invocable: parsed.disableModelInvocation ? 0 : 1
          })
        }
      }
    }

    const existingRegistry = db
      .prepare('SELECT name, marketplace, scope, install_path, project_path FROM plugin_registry')
      .all() as {
      name: string
      marketplace: string
      scope: NormalizedInstall['scope']
      install_path: string
      project_path: string
    }[]
    const deleteRegistryRow = db.prepare(
      `DELETE FROM plugin_registry
       WHERE name = ? AND marketplace = ? AND scope = ? AND install_path = ? AND project_path = ?`
    )
    for (const row of existingRegistry) {
      const key = registryKey(
        row.name,
        row.marketplace,
        row.scope,
        row.install_path,
        row.project_path
      )
      if (!seenRegistryKeys.has(key)) {
        deleteRegistryRow.run(
          row.name,
          row.marketplace,
          row.scope,
          row.install_path,
          row.project_path
        )
      }
    }

    if (pluginSkillScanIsAuthoritative) {
      writeSkillScanAuthoritative(db, 'plugin', skillRows)
    } else if (readableSkillRoots.length > 0) {
      writeSkillScan(db, 'plugin', skillRows, readableSkillRoots)
    }
  })

  runScan()
}
