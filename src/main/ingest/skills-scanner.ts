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
      const dirPath = join(root.dir, entryName)
      const skillMdPath = join(dirPath, 'SKILL.md')
      if (!allowedExistsSync(skillMdPath)) continue

      const parsed = parseSkillDirectory(dirPath)
      const stats = allowedStatSync(skillMdPath)
      rows.push({
        name: parsed.name,
        source_path: dirPath,
        plugin_name: null,
        description: parsed.description,
        est_listing_tokens: parsed.est_listing_tokens,
        est_body_tokens: parsed.est_body_tokens,
        project_root: root.projectRoot ?? null,
        license: parsed.license,
        metadata_json: parsed.metadata_json,
        created_at: stats?.birthtime.toISOString() ?? null,
        modified_at: stats?.mtime.toISOString() ?? null
      })
    }
  }

  for (const [sourceType, rootDirs] of rootDirsBySourceType) {
    writeSkillScan(db, sourceType, rowsBySourceType.get(sourceType) ?? [], rootDirs)
  }
}
