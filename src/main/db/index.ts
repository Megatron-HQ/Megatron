import { app } from 'electron'
import { join } from 'path'
import type Database from 'better-sqlite3'
import { openIndex } from './schema'
import { securePrivateDataDirectory } from '../permissions'
import { openUsageArchive, USAGE_ARCHIVE_FILENAME } from './usage-archive'

let db: Database.Database | null = null
let usageArchive: Database.Database | null = null

export function getUsageArchive(): Database.Database {
  if (!usageArchive) {
    const directory = app.getPath('userData')
    const ownedRoot = join(app.getPath('appData'), app.getName())
    securePrivateDataDirectory(directory, ownedRoot)
    usageArchive = openUsageArchive(join(directory, USAGE_ARCHIVE_FILENAME))
    securePrivateDataDirectory(directory, ownedRoot)
  }
  return usageArchive
}

export function getDb(): Database.Database {
  if (!db) {
    securePrivateDataDirectory(app.getPath('userData'), join(app.getPath('appData'), app.getName()))
    db = openIndex(join(app.getPath('userData'), 'megatron.db'))
    securePrivateDataDirectory(app.getPath('userData'), join(app.getPath('appData'), app.getName()))
  }
  return db
}
