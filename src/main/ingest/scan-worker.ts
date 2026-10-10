import { parentPort, workerData } from 'worker_threads'
import Database from 'better-sqlite3'
import { restoreGrantedPath } from '../permissions'
import { scanSkills } from './skills-scanner'
import { scanPluginRegistry } from './plugin-registry'
import { scanTranscripts } from './transcript-scanner'
import { scanPromptHistory } from './prompt-history-scanner'
import { runLinter } from '../linter'
import { runAllScans } from './scan-all'

const { databasePath, grantedPaths } = workerData as {
  databasePath: string
  grantedPaths: string[]
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
