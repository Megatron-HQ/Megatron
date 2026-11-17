import Database from 'better-sqlite3'
import { createHash } from 'crypto'
import { rmSync } from 'fs'
import schemaSql from './schema.sql?raw'

// Any edit to schema.sql, comments included, or a launch on another Claude Code config folder changes
// this stamp. The index is a pure derived cache of that folder, so a mismatch is answered by deleting
// and rebuilding it, never by migrating it.
// `|| 1` keeps the stamp clear of 0, which is SQLite's value for a never-stamped file.
function indexStamp(configDirectory: string): number {
  const digest = createHash('sha256')
    .update(schemaSql)
    .update('\0')
    .update(configDirectory)
    .digest()
  return digest.readUInt32BE(0) & 0x7fffffff || 1
}

export function applySchema(db: Database.Database): void {
  db.pragma('foreign_keys = ON')
  db.exec(schemaSql)
}

export function openIndex(path: string, configDirectory: string): Database.Database {
  const stamp = indexStamp(configDirectory)
  let db = new Database(path)
  if (db.pragma('user_version', { simple: true }) !== stamp) {
    db.close()
    // A leftover -wal or -journal from the old file would be replayed into the new one.
    for (const suffix of ['', '-wal', '-shm', '-journal'])
      rmSync(`${path}${suffix}`, { force: true })
    db = new Database(path)
  }
  db.pragma('journal_mode = WAL')
  applySchema(db)
  db.pragma(`user_version = ${stamp}`)
  return db
}
