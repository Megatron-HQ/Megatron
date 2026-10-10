import { app } from 'electron'
import { join } from 'path'
import Database from 'better-sqlite3'
import { applySchema } from './schema'
import { securePrivateDataDirectory } from '../permissions'

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (!db) {
    securePrivateDataDirectory(app.getPath('userData'), join(app.getPath('appData'), app.getName()))
    db = new Database(join(app.getPath('userData'), 'megatron.db'))
    db.pragma('journal_mode = WAL')
    applySchema(db)
    securePrivateDataDirectory(app.getPath('userData'), join(app.getPath('appData'), app.getName()))
  }
  return db
}
