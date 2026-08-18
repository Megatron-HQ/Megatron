import type Database from 'better-sqlite3'
import { homedir } from 'os'
import { join, resolve } from 'path'
import { writeSkillScan, writeSkillScanAuthoritative, type SkillScanRow } from '../db/queries'
import { allowedExistsSync, allowedReadFileSync, readAllowedDirectory } from '../permissions'
import { parseSkillDirectory } from './skill-parser'

interface PluginInstallEntry {
  scope?: unknown
  installPath?: unknown
  version?: unknown
  installedAt?: unknown
  lastUpdated?: unknown
  gitCommitSha?: unknown
}

interface MarketplaceEntry {
  source?: { repo?: unknown }
}

function registryKey(name: string, marketplace: string, installPath: string): string {
  return JSON.stringify([name, marketplace, installPath])
}

type JsonReadStatus = 'ok' | 'missing' | 'unavailable' | 'invalid'

interface JsonRead {
  status: JsonReadStatus
  value: unknown
}

function readJson(filePath: string): JsonRead {
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

function splitPluginKey(key: string): { name: string; marketplace: string } {
  const atIndex = key.lastIndexOf('@')
  return { name: key.slice(0, atIndex), marketplace: key.slice(atIndex + 1) }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function scanPluginRegistry(
  db: Database.Database,
  pluginsDir: string = resolve(homedir(), '.claude', 'plugins')
): void {
  const pluginsDirectory = readAllowedDirectory(pluginsDir)
  if (pluginsDirectory.status === 'unavailable') return

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
       installed_at, last_updated, git_commit_sha)
    VALUES (@name, @marketplace, @marketplace_repo, @installed_version, @scope, @install_path, @last_scanned_at,
       @installed_at, @last_updated, @git_commit_sha)
    ON CONFLICT(name, marketplace, install_path) DO UPDATE SET
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
      git_commit_sha = excluded.git_commit_sha
  `)

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

      const entries = Array.isArray(entriesRaw) ? entriesRaw : []
      for (const entryRaw of entries) {
        if (!isRecord(entryRaw)) continue
        const entry = entryRaw as PluginInstallEntry

        const scope = entry.scope
        if (scope !== 'user' && scope !== 'project') continue

        const installPath = typeof entry.installPath === 'string' ? entry.installPath : null
        if (installPath === null) continue

        const version = typeof entry.version === 'string' ? entry.version : 'unknown'
        const installedAt = typeof entry.installedAt === 'string' ? entry.installedAt : null
        const lastUpdated = typeof entry.lastUpdated === 'string' ? entry.lastUpdated : null
        const gitCommitSha = typeof entry.gitCommitSha === 'string' ? entry.gitCommitSha : null

        upsertRegistry.run({
          name,
          marketplace,
          marketplace_repo: repo,
          installed_version: version,
          scope,
          install_path: installPath,
          last_scanned_at: now,
          has_marketplace_snapshot: hasMarketplaceSnapshot ? 1 : 0,
          installed_at: installedAt,
          last_updated: lastUpdated,
          git_commit_sha: gitCommitSha
        })
        seenRegistryKeys.add(registryKey(name, marketplace, installPath))

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
            name: parsed.name,
            source_path: dirPath,
            plugin_name: `${name}@${marketplace}`,
            description: parsed.description,
            est_listing_tokens: parsed.est_listing_tokens,
            est_body_tokens: parsed.est_body_tokens,
            license: parsed.license,
            metadata_json: parsed.metadata_json,
            created_at: null,
            modified_at: null
          })
        }
      }
    }

    const existingRegistry = db
      .prepare('SELECT name, marketplace, install_path FROM plugin_registry')
      .all() as {
      name: string
      marketplace: string
      install_path: string
    }[]
    for (const row of existingRegistry) {
      if (!seenRegistryKeys.has(registryKey(row.name, row.marketplace, row.install_path))) {
        db.prepare(
          'DELETE FROM plugin_registry WHERE name = ? AND marketplace = ? AND install_path = ?'
        ).run(row.name, row.marketplace, row.install_path)
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
