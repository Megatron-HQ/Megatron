import { parentPort, workerData } from 'worker_threads'
import { assertConfigRootAvailable } from '../config-root'
import { homedir } from 'os'
import { join } from 'path'
import Database from 'better-sqlite3'
import { restoreGrantedPath, setClaudeConfig, type ConfigRoot } from '../permissions'
import { setWorktreeLinkSource } from '../db/queries'
import { scanSkills as runSkillScan } from './skills-scanner'
import type { ProjectFolder, ScanTaskResult, WorktreeLink } from '../../shared/ipc'
import { setClaudeCodeFolders } from '../../shared/project-path'
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
  configRoot,
  grantedPaths,
  previousProjects = [],
  worktreeLinks = [],
  scope = 'all'
} = workerData as {
  databasePath: string
  archivePath: string
  configRoot: ConfigRoot
  grantedPaths: string[]
  previousProjects?: ProjectFolder[]
  worktreeLinks?: WorktreeLink[]
  scope?: ScanScope
}
// The worker has its own module state: Tier 1 must name the same folder main resolved at startup.
setClaudeConfig(configRoot)
setClaudeCodeFolders([configRoot.directory, join(homedir(), '.claude')])
for (const path of grantedPaths) restoreGrantedPath(path)
setWorktreeLinkSource(() => worktreeLinks)
const database = new Database(databasePath)
let archive: Database.Database | undefined
const getArchive = (): Database.Database => (archive ??= openUsageArchive(archivePath))
const usageScans = createUsageScanTasks({
  scanTranscripts: runTranscriptScan,
  scanPromptHistory: runPromptScan,
  getArchive
})
let sourceStartedAt = 0
let pruningLinks = worktreeLinks
function scanSkills(db: Database.Database): ScanTaskResult {
  const result = runSkillScan(db, undefined, undefined, previousProjects, worktreeLinks)
  if (result.worktrees) pruningLinks = [...result.worktrees, ...worktreeLinks]
  return result
}
try {
  const summary = runAllScans(
    database,
    selectScanTasks(scope, [
      ...usageScans,
      { name: 'scanSkills', run: scanSkills },
      {
        name: 'scanPluginRegistry',
        run: (db: Database.Database) => scanPluginRegistry(db, undefined, undefined, pruningLinks)
      },
      // Not gated on the registry scan's status: leftover index rows are still real sightings,
      // and recording one late only delays a 30-day signal. Full scans only (selectScanTasks).
      {
        name: 'archivePluginSkills',
        run: (db: Database.Database) => recordPluginSkillSightings(db, getArchive())
      },
      { name: 'runLinter', run: runLinter }
    ]).map((task) => ({
      name: task.name,
      run: (db: Database.Database) => {
        assertConfigRootAvailable()
        const result = typeof task === 'function' ? task(db) : task.run(db)
        assertConfigRootAvailable()
        return result
      }
    })),
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
