import type Database from 'better-sqlite3'
import type { SkillRow } from '../../shared/ipc'

export function listSkills(db: Database.Database): SkillRow[] {
  return db
    .prepare(
      `SELECT id, name, source_type, source_path, plugin_name, description, last_scanned_at
       FROM skills`
    )
    .all() as SkillRow[]
}
