import { app } from 'electron'
import { join } from 'path'
import Database from 'better-sqlite3'
import { applySchema } from './schema'

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(join(app.getPath('userData'), 'megatron.db'))
    applySchema(db)
  }
  return db
}
