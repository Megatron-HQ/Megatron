import type Database from 'better-sqlite3'
import schemaSql from './schema.sql?raw'

export function applySchema(db: Database.Database): void {
  db.exec(schemaSql)
}
