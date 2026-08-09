import { app } from 'electron'
import { join } from 'path'
import Database from 'better-sqlite3'

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!db) {
    db = new Database(join(app.getPath('userData'), 'megatron.db'))
  }
  return db
}
