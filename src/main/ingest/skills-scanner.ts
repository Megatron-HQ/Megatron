import type Database from 'better-sqlite3'
import { existsSync, readdirSync } from 'fs'
import { homedir } from 'os'
import { dirname, join, resolve } from 'path'
import { getGrantedPaths, isPathAllowed } from '../permissions'
import { parseSkillDirectory } from './skill-parser'

export interface SkillRoot {
  dir: string
  sourceType: 'global' | 'project'
}

export function defaultSkillRoots(): SkillRoot[] {
  const globalRoot: SkillRoot = {
    dir: resolve(homedir(), '.claude', 'skills'),
    sourceType: 'global'
  }
  const projectRoots: SkillRoot[] = getGrantedPaths().map((path) => ({
    dir: join(path, '.claude', 'skills'),
    sourceType: 'project'
  }))
  return [globalRoot, ...projectRoots]
}

export function scanSkills(db: Database.Database, roots: SkillRoot[] = defaultSkillRoots()): void {
  const upsert = db.prepare(`
    INSERT INTO skills (name, source_type, source_path, plugin_name, description, last_scanned_at)
    VALUES (@name, @source_type, @source_path, NULL, @description, @last_scanned_at)
    ON CONFLICT(source_path) DO UPDATE SET
      name = excluded.name,
      source_type = excluded.source_type,
      description = excluded.description,
      last_scanned_at = excluded.last_scanned_at
  `)

  const runScan = db.transaction(() => {
    const seenPaths = new Set<string>()

    for (const root of roots) {
      if (!existsSync(root.dir)) continue

      let entries: string[]
      try {
        entries = readdirSync(root.dir)
      } catch {
        continue
      }

      for (const entryName of entries) {
        const dirPath = join(root.dir, entryName)
        const skillMdPath = join(dirPath, 'SKILL.md')
        if (!existsSync(skillMdPath)) continue
        if (!isPathAllowed(dirPath)) continue

        const parsed = parseSkillDirectory(dirPath)
        seenPaths.add(dirPath)
        upsert.run({
          name: parsed.name,
          source_type: root.sourceType,
          source_path: dirPath,
          description: parsed.description,
          last_scanned_at: new Date().toISOString()
        })
      }
    }

    // ponytail: rows survive if their root is dropped from `roots` entirely (e.g. a revoked
    // project grant) — cleanup only happens on a scan that still includes that root and finds
    // it empty. Add eager cleanup-on-revoke if M3's picker needs it.
    const scannedRootDirs = new Set(roots.map((root) => root.dir))
    const existing = db.prepare('SELECT source_path FROM skills').all() as { source_path: string }[]
    const staleRootPaths = existing
      .map((row) => row.source_path)
      .filter((path) => scannedRootDirs.has(dirname(path)) && !seenPaths.has(path))

    if (staleRootPaths.length > 0) {
      const placeholders = staleRootPaths.map(() => '?').join(', ')
      db.prepare(`DELETE FROM skills WHERE source_path IN (${placeholders})`).run(...staleRootPaths)
    }
  })

  runScan()
}
