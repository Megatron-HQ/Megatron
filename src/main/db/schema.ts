import type Database from 'better-sqlite3'
import schemaSql from './schema.sql?raw'

// Schema changes are applied by deleting the index, not by migrating it — the DB is a pure
// derived cache of ~/.claude/. See docs/data-model.md.
export function applySchema(db: Database.Database): void {
  db.pragma('foreign_keys = ON')
  db.exec(schemaSql)
}
