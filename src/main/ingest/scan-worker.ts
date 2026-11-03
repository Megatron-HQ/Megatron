import { parentPort, workerData } from 'worker_threads'
import Database from 'better-sqlite3'
import { restoreGrantedPath } from '../permissions'
import { scanSkills as runSkillScan } from './skills-scanner'
import type { ProjectFolder, ScanTaskResult } from '../../shared/ipc'
import { scanPluginRegistry } from './plugin-registry'
import { scanTranscripts as runTranscriptScan } from './transcript-scanner'
import { scanPromptHistory as runPromptScan } from './prompt-history-scanner'
import { openUsageArchive } from '../db/usage-archive'
import { archiveUsageHistory } from './usage-history'
import { runLinter } from '../linter'
import { runAllScans, type ScanScope } from './scan-all'

const {
  databasePath,
  archivePath,
  grantedPaths,
  previousProjects = [],
  scope = 'all'
} = workerData as {
  databasePath: string
  archivePath: string
  grantedPaths: string[]
  previousProjects?: ProjectFolder[]
  scope?: ScanScope
}
function scanSkills(db: Database.Database): ScanTaskResult {
  return runSkillScan(db, undefined, undefined, previousProjects)
}
for (const path of grantedPaths) restoreGrantedPath(path)
const database = new Database(databasePath)
const archive = openUsageArchive(archivePath)
function scanTranscripts(db: Database.Database): ScanTaskResult {
  const result = runTranscriptScan(db)
  if (result.status === 'complete')
    archiveUsageHistory(db, archive, { prompts: false, tokens: true })
  return result
}
function scanPromptHistory(db: Database.Database): ScanTaskResult {
  const result = runPromptScan(db)
  if (result.status === 'complete')
    archiveUsageHistory(db, archive, { prompts: true, tokens: false })
  return result
}
try {
  const summary = runAllScans(
    database,
    scope === 'plugins'
      ? [scanPluginRegistry]
      : [scanSkills, scanPluginRegistry, scanTranscripts, scanPromptHistory, runLinter],
    (error) => {
      console.error('[ingest] scan failed', error)
    }
  )
  parentPort?.postMessage(summary)
} finally {
  archive.close()
  database.close()
}
