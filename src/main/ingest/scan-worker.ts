import { parentPort, workerData } from 'worker_threads'
import Database from 'better-sqlite3'
import { restoreGrantedPath } from '../permissions'
import { scanSkills as runSkillScan } from './skills-scanner'
import type { ProjectFolder, ScanTaskResult } from '../../shared/ipc'
import { scanPluginRegistry } from './plugin-registry'
import { scanTranscripts } from './transcript-scanner'
import { scanPromptHistory } from './prompt-history-scanner'
import { runLinter } from '../linter'
import { runAllScans } from './scan-all'

const {
  databasePath,
  grantedPaths,
  previousProjects = []
} = workerData as {
  databasePath: string
  grantedPaths: string[]
  previousProjects?: ProjectFolder[]
}
function scanSkills(db: Database.Database): ScanTaskResult {
  return runSkillScan(db, undefined, undefined, previousProjects)
}
for (const path of grantedPaths) restoreGrantedPath(path)
const database = new Database(databasePath)
try {
  const summary = runAllScans(
    database,
    [scanSkills, scanPluginRegistry, scanTranscripts, scanPromptHistory, runLinter],
    (error) => {
      console.error('[ingest] scan failed', error)
    }
  )
  parentPort?.postMessage(summary)
} finally {
  database.close()
}
