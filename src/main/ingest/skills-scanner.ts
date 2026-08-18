import type Database from 'better-sqlite3'
import { homedir } from 'os'
import { join, resolve } from 'path'
import { writeSkillScan, type SkillScanRow } from '../db/queries'
import {
  allowedExistsSync,
  allowedStatSync,
  getGrantedPaths,
  readAllowedDirectory
} from '../permissions'
import { parseSkillDirectory } from './skill-parser'

export interface SkillRoot {
  dir: string
  sourceType: 'global' | 'project'
  projectRoot?: string
}

export function defaultSkillRoots(): SkillRoot[] {
  const globalRoot: SkillRoot = {
    dir: resolve(homedir(), '.claude', 'skills'),
    sourceType: 'global'
  }
  const projectRoots: SkillRoot[] = getGrantedPaths().map((path) => ({
    dir: join(path, '.claude', 'skills'),
    sourceType: 'project',
    projectRoot: path
  }))
  return [globalRoot, ...projectRoots]
}

const SYNCED_DIR_NAME = 'synced'

// A skill directory is `<parentDir>/<entryName>`, real iff it has its own SKILL.md.
// Shared by the top-level walk and the one-level-deeper synced/ walk below.
function scanSkillEntry(
  parentDir: string,
  entryName: string,
  projectRoot: string | undefined,
  isSynced: boolean
): SkillScanRow | null {
  const dirPath = join(parentDir, entryName)
  const skillMdPath = join(dirPath, 'SKILL.md')
  if (!allowedExistsSync(skillMdPath)) return null

  const parsed = parseSkillDirectory(dirPath)
  const stats = allowedStatSync(skillMdPath)
  return {
    name: parsed.name,
    source_path: dirPath,
    plugin_name: null,
    description: parsed.description,
    est_listing_tokens: parsed.est_listing_tokens,
    est_body_tokens: parsed.est_body_tokens,
    project_root: projectRoot ?? null,
    license: parsed.license,
    metadata_json: parsed.metadata_json,
    created_at: stats?.birthtime.toISOString() ?? null,
    modified_at: stats?.mtime.toISOString() ?? null,
    // better-sqlite3 only binds numbers/strings/bigints/buffers/null, not booleans.
    is_synced: isSynced ? 1 : 0
  }
}

// ponytail: a source_type whose root is dropped from `roots` entirely (e.g. a revoked
// project grant) never gets its rows deleted — writeSkillScan is only called for source
// types with at least one root this pass, so an absent root's rows are simply never
// considered. Add eager cleanup-on-revoke if M3's picker needs it.
export function scanSkills(db: Database.Database, roots: SkillRoot[] = defaultSkillRoots()): void {
  const rowsBySourceType = new Map<SkillRoot['sourceType'], SkillScanRow[]>()
  const rootDirsBySourceType = new Map<SkillRoot['sourceType'], string[]>()

  for (const root of roots) {
    const directory = readAllowedDirectory(root.dir)
    if (directory.status === 'unavailable') continue

    const rows = rowsBySourceType.get(root.sourceType) ?? []
    rowsBySourceType.set(root.sourceType, rows)
    const rootDirs = rootDirsBySourceType.get(root.sourceType) ?? []
    rootDirs.push(root.dir)
    rootDirsBySourceType.set(root.sourceType, rootDirs)

    for (const entryName of directory.entries) {
      // `synced/` is a reserved folder name (any capitalization) that Claude Code itself
      // never treats as a skill — it's one extra level holding claude.ai-synced skills.
      // See docs/skill-scanner.md.
      if (entryName.toLowerCase() === SYNCED_DIR_NAME) {
        const syncedDir = join(root.dir, entryName)
        const syncedEntries = readAllowedDirectory(syncedDir)
        if (syncedEntries.status === 'unavailable') continue
        // The stale-row reconciliation below matches on a row's immediate parent dir, so
        // synced/ has to be a root in its own right or a deleted synced skill never gets swept.
        rootDirs.push(syncedDir)
        for (const syncedEntryName of syncedEntries.entries) {
          const row = scanSkillEntry(syncedDir, syncedEntryName, root.projectRoot, true)
          if (row) rows.push(row)
        }
        continue
      }

      const row = scanSkillEntry(root.dir, entryName, root.projectRoot, false)
      if (row) rows.push(row)
    }
  }

  for (const [sourceType, rootDirs] of rootDirsBySourceType) {
    writeSkillScan(db, sourceType, rowsBySourceType.get(sourceType) ?? [], rootDirs)
  }
}
