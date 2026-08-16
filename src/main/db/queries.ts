import type Database from 'better-sqlite3'
import { dirname, join, resolve, sep } from 'path'
import type { AllowedPathRow, SkillRow, SourceType } from '../../shared/ipc'

export function listSkills(db: Database.Database): SkillRow[] {
  return db
    .prepare(
      `SELECT id, name, source_type, source_path, plugin_name, description, last_scanned_at
       FROM skills`
    )
    .all() as SkillRow[]
}

export function getSkillById(db: Database.Database, id: number): SkillRow | null {
  const row = db
    .prepare(
      `SELECT id, name, source_type, source_path, plugin_name, description, last_scanned_at
       FROM skills WHERE id = ?`
    )
    .get(id) as SkillRow | undefined
  return row ?? null
}

export interface SkillScanRow {
  name: string
  source_path: string
  plugin_name: string | null
  description: string | null
}

// Upserts `rows` as `sourceType`, then deletes existing `sourceType` rows that
// `computeStalePaths` marks stale. The two exported writers below differ only in
// what "stale" means for their caller — the SQL lives here exactly once.
function writeSkillRows(
  db: Database.Database,
  sourceType: SourceType,
  rows: SkillScanRow[],
  computeStalePaths: (existingPaths: string[]) => string[]
): void {
  const runScan = db.transaction(() => {
    const upsert = db.prepare(`
      INSERT INTO skills (name, source_type, source_path, plugin_name, description, last_scanned_at)
      VALUES (@name, @source_type, @source_path, @plugin_name, @description, @last_scanned_at)
      ON CONFLICT(source_path) DO UPDATE SET
        name = excluded.name,
        source_type = excluded.source_type,
        plugin_name = excluded.plugin_name,
        description = excluded.description,
        last_scanned_at = excluded.last_scanned_at
    `)
    const now = new Date().toISOString()
    for (const row of rows) {
      upsert.run({
        name: row.name,
        source_type: sourceType,
        source_path: row.source_path,
        plugin_name: row.plugin_name,
        description: row.description,
        last_scanned_at: now
      })
    }

    const existingPaths = (
      db.prepare('SELECT source_path FROM skills WHERE source_type = ?').all(sourceType) as {
        source_path: string
      }[]
    ).map((row) => row.source_path)
    const stalePaths = computeStalePaths(existingPaths)

    if (stalePaths.length > 0) {
      const placeholders = stalePaths.map(() => '?').join(', ')
      db.prepare(`DELETE FROM skills WHERE source_path IN (${placeholders})`).run(...stalePaths)
    }
  })

  runScan()
}

// Authoritative over every row of `sourceType` — for scans that read their whole
// source universe in one pass (the plugin registry).
export function writeSkillScanAuthoritative(
  db: Database.Database,
  sourceType: SourceType,
  rows: SkillScanRow[]
): void {
  const seenPaths = new Set(rows.map((row) => row.source_path))
  writeSkillRows(db, sourceType, rows, (existingPaths) =>
    existingPaths.filter((path) => !seenPaths.has(path))
  )
}

// Authoritative only over rows living directly under `rootDirs` — for scans handed
// an explicit, possibly partial, set of roots.
export function writeSkillScan(
  db: Database.Database,
  sourceType: SourceType,
  rows: SkillScanRow[],
  rootDirs: string[]
): void {
  const seenPaths = new Set(rows.map((row) => row.source_path))
  const rootDirSet = new Set(rootDirs)
  writeSkillRows(db, sourceType, rows, (existingPaths) =>
    existingPaths.filter((path) => rootDirSet.has(dirname(path)) && !seenPaths.has(path))
  )
}

export function listAllowedPaths(db: Database.Database): AllowedPathRow[] {
  return db
    .prepare('SELECT path, granted_at FROM allowed_paths ORDER BY granted_at ASC')
    .all() as AllowedPathRow[]
}

export function addAllowedPath(db: Database.Database, path: string): void {
  const resolved = resolve(path)
  const now = new Date().toISOString()
  db.prepare(
    `
    INSERT INTO allowed_paths (path, granted_at)
    VALUES (?, ?)
    ON CONFLICT(path) DO UPDATE SET granted_at = excluded.granted_at
  `
  ).run(resolved, now)
}

export function removeAllowedPath(db: Database.Database, path: string): void {
  const resolved = resolve(path)
  db.prepare('DELETE FROM allowed_paths WHERE path = ?').run(resolved)
}

export function deleteSkillsForProjectRoot(db: Database.Database, projectRoot: string): void {
  const resolvedRoot = resolve(projectRoot)
  const skillsDir = join(resolvedRoot, '.claude', 'skills')
  const rows = db
    .prepare("SELECT id, source_path FROM skills WHERE source_type = 'project'")
    .all() as { id: number; source_path: string }[]

  const idsToDelete = rows
    .filter((row) => {
      const resolvedPath = resolve(row.source_path)
      return (
        resolvedPath === skillsDir ||
        resolvedPath.startsWith(skillsDir + sep) ||
        resolvedPath.startsWith(resolvedRoot + sep)
      )
    })
    .map((row) => row.id)

  if (idsToDelete.length > 0) {
    const placeholders = idsToDelete.map(() => '?').join(', ')
    db.prepare(`DELETE FROM skills WHERE id IN (${placeholders})`).run(...idsToDelete)
  }
}
