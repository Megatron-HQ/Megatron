import { parentPort, workerData } from 'worker_threads'
import Database from 'better-sqlite3'
import { restoreGrantedPath } from '../permissions'
import { scanSkills as runSkillScan } from './skills-scanner'
import type { ProjectFolder, ScanTaskResult } from '../../shared/ipc'
import { scanPluginRegistry } from './plugin-registry'
import { scanTranscripts as runTranscriptScan } from './transcript-scanner'
import { scanPromptHistory as runPromptScan } from './prompt-history-scanner'
import { openUsageArchive } from '../db/usage-archive'
import { recordPluginSkillSightings } from '../db/stale-skills'
import { createUsageScanTasks } from './usage-scan-tasks'
import { runLinter } from '../linter'
import { runAllScans, selectScanTasks, type ScanScope } from './scan-all'

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
let archive: Database.Database | undefined
const getArchive = (): Database.Database => (archive ??= openUsageArchive(archivePath))
const usageScans = createUsageScanTasks({
  scanTranscripts: runTranscriptScan,
  scanPromptHistory: runPromptScan,
  getArchive
})
let sourceStartedAt = 0
try {
  const summary = runAllScans(
    database,
    selectScanTasks(scope, [
      ...usageScans,
      { name: 'scanSkills', run: scanSkills },
      { name: 'scanPluginRegistry', run: scanPluginRegistry },
      // Not gated on the registry scan's status: leftover index rows are still real sightings,
      // and recording one late only delays a 30-day signal. Full scans only (selectScanTasks).
      {
        name: 'archivePluginSkills',
        run: (db: Database.Database) => recordPluginSkillSightings(db, getArchive())
      },
      { name: 'runLinter', run: runLinter }
    ]),
    (error) => {
      console.error('[ingest] scan failed', error)
    },
    (progress) => {
      if (progress.type === 'source-started') sourceStartedAt = Date.now()
      else
        console.info(
          `[ingest] ${progress.source.name}: ${progress.source.status} (${Date.now() - sourceStartedAt} ms)`
        )
      parentPort?.postMessage(progress)
    }
  )
  parentPort?.postMessage(summary)
} finally {
  archive?.close()
  database.close()
}
