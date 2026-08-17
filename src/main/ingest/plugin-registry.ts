import type Database from 'better-sqlite3'
import { existsSync, readFileSync } from 'fs'
import { homedir } from 'os'
import { join, resolve } from 'path'
import { writeSkillScanAuthoritative, type SkillScanRow } from '../db/queries'
import { allowedExistsSync, allowedReaddirSync, isPathAllowed } from '../permissions'
import { parseSkillDirectory } from './skill-parser'

interface PluginInstallEntry {
  scope?: unknown
  installPath?: unknown
  version?: unknown
}

interface MarketplaceEntry {
  source?: { repo?: unknown }
}

function readJson(filePath: string): unknown {
  if (!isPathAllowed(filePath) || !existsSync(filePath)) return null
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'))
  } catch {
    return null
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
  const installedRaw = readJson(join(pluginsDir, 'installed_plugins.json'))
  const marketplacesRaw = readJson(join(pluginsDir, 'known_marketplaces.json'))

  const pluginsMap =
    isRecord(installedRaw) && isRecord(installedRaw.plugins)
      ? (installedRaw.plugins as Record<string, unknown>)
      : {}
  const marketplaces = isRecord(marketplacesRaw)
    ? (marketplacesRaw as Record<string, MarketplaceEntry>)
    : {}

  const upsertRegistry = db.prepare(`
    INSERT INTO plugin_registry
      (name, marketplace, marketplace_repo, installed_version, scope, install_path, last_scanned_at)
    VALUES (@name, @marketplace, @marketplace_repo, @installed_version, @scope, @install_path, @last_scanned_at)
    ON CONFLICT(name, marketplace) DO UPDATE SET
      marketplace_repo = excluded.marketplace_repo,
      installed_version = excluded.installed_version,
      scope = excluded.scope,
      install_path = excluded.install_path,
      last_scanned_at = excluded.last_scanned_at
  `)

  const runScan = db.transaction(() => {
    const seenRegistryKeys = new Set<string>()
    const skillRows: SkillScanRow[] = []
    const now = new Date().toISOString()

    for (const [key, entriesRaw] of Object.entries(pluginsMap)) {
      const { name, marketplace } = splitPluginKey(key)
      const marketplaceRepo = marketplaces[marketplace]?.source?.repo
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

        upsertRegistry.run({
          name,
          marketplace,
          marketplace_repo: repo,
          installed_version: version,
          scope,
          install_path: installPath,
          last_scanned_at: now
        })
        seenRegistryKeys.add(`${name}@${marketplace}`)

        const skillsDir = join(installPath, 'skills')
        const skillEntries = allowedReaddirSync(skillsDir)

        for (const entryName of skillEntries) {
          const dirPath = join(skillsDir, entryName)
          if (!allowedExistsSync(join(dirPath, 'SKILL.md'))) continue

          const parsed = parseSkillDirectory(dirPath)
          skillRows.push({
            name: parsed.name,
            source_path: dirPath,
            plugin_name: `${name}@${marketplace}`,
            description: parsed.description,
            est_listing_tokens: parsed.est_listing_tokens,
            est_body_tokens: parsed.est_body_tokens
          })
        }
      }
    }

    const existingRegistry = db.prepare('SELECT name, marketplace FROM plugin_registry').all() as {
      name: string
      marketplace: string
    }[]
    for (const row of existingRegistry) {
      if (!seenRegistryKeys.has(`${row.name}@${row.marketplace}`)) {
        db.prepare('DELETE FROM plugin_registry WHERE name = ? AND marketplace = ?').run(
          row.name,
          row.marketplace
        )
      }
    }

    writeSkillScanAuthoritative(db, 'plugin', skillRows)
  })

  runScan()
}
