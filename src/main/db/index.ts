import { app } from 'electron'
import { homedir } from 'os'
import { join } from 'path'
import type Database from 'better-sqlite3'
import { openIndex } from './schema'
import { claudeConfig, securePrivateDataDirectory } from '../permissions'
import { openUsageArchive, usageArchiveFilename } from './usage-archive'
import { ownedDataFolder } from '../data-folder'
import { attachUsageArchive } from './known-calls'

let db: Database.Database | null = null
let usageArchive: Database.Database | null = null
let archivePath: string | undefined

export function usageArchivePath(): string {
  const config = claudeConfig()
  return (archivePath ??= join(
    app.getPath('userData'),
    usageArchiveFilename(config.directory, homedir(), config.canonicalDirectory)
  ))
}

export function getUsageArchive(): Database.Database {
  if (!usageArchive) {
    const directory = app.getPath('userData')
    const ownedRoot = ownedDataFolder(app)
    securePrivateDataDirectory(directory, ownedRoot)
    usageArchive = openUsageArchive(usageArchivePath())
    securePrivateDataDirectory(directory, ownedRoot)
  }
  return usageArchive
}

export function getDb(): Database.Database {
  if (!db) {
    securePrivateDataDirectory(app.getPath('userData'), ownedDataFolder(app))
    const config = claudeConfig()
    const profile =
      config.canonicalDirectory === undefined
        ? config.directory
        : `${config.directory}\0${config.canonicalDirectory}`
    db = openIndex(join(app.getPath('userData'), 'megatron.db'), profile)
    securePrivateDataDirectory(app.getPath('userData'), ownedDataFolder(app))
    attachArchiveForLifetimeCounts(db)
  }
  return db
}

// Uses, Last used and MCP call counts read the archive through this attachment (known-calls.ts).
// Without it they fall back to the transcripts the index still holds, so a damaged archive costs
// history, never the app.
function attachArchiveForLifetimeCounts(index: Database.Database): void {
  try {
    // Opened first: openUsageArchive creates the tables the attachment checks for.
    getUsageArchive()
    attachUsageArchive(index, usageArchivePath())
  } catch (error) {
    console.error('[db] usage archive not attached; counts cover retained transcripts only', error)
  }
}
