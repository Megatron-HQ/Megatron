import { parentPort, workerData } from 'worker_threads'
import { assertConfigRootAvailable } from '../config-root'
import Database from 'better-sqlite3'
import { restoreGrantedPath, setClaudeConfig, type ConfigRoot } from '../permissions'
import { scanSkills as runSkillScan } from './skills-scanner'
import type { ProjectFolder } from '../../shared/ipc'
import { readProjectIdentity, type ProjectIdentitySnapshot } from '../../shared/project-identity'
import { scanPluginRegistry } from './plugin-registry'
import { scanMcpDeclarations } from './mcp-declarations'
import { createGitRepos } from './git-repos'
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
  projectIdentity,
  scope = 'all'
} = workerData as {
  databasePath: string
  archivePath: string
  configRoot: ConfigRoot
  grantedPaths: string[]
  previousProjects?: ProjectFolder[]
  projectIdentity: ProjectIdentitySnapshot
  scope?: ScanScope
}
// The worker has its own module state: Tier 1 must name the same folder main resolved at startup.
setClaudeConfig(configRoot)
for (const path of grantedPaths) restoreGrantedPath(path)
const identity = readProjectIdentity(projectIdentity)
const database = new Database(databasePath)
let archive: Database.Database | undefined
const getArchive = (): Database.Database => (archive ??= openUsageArchive(archivePath))
const usageScans = createUsageScanTasks({
  scanTranscripts: runTranscriptScan,
  scanPromptHistory: runPromptScan,
  getArchive
})
// One per Scan: the skills and plugin tasks share its git reads and this Scan's links.
const repos = createGitRepos(projectIdentity)
// Filled by the plugin pass and read by the MCP pass; holds credentials, so it never leaves here.
const pluginMcpEndpoints = new Map<string, string>()
let sourceStartedAt = 0
try {
  const summary = runAllScans(
    database,
    selectScanTasks(scope, [
      ...usageScans,
      {
        name: 'scanSkills',
        run: (db: Database.Database) =>
          runSkillScan(db, undefined, undefined, previousProjects, repos)
      },
      {
        name: 'scanPluginRegistry',
        run: (db: Database.Database) =>
          scanPluginRegistry(db, undefined, undefined, repos, pluginMcpEndpoints)
      },
      {
        name: 'scanMcpDeclarations',
        run: (db: Database.Database) =>
          scanMcpDeclarations(db, {
            candidateProjects: previousProjects.map((project) => project.path),
            pluginEndpoints: pluginMcpEndpoints
          })
      },
      // Not gated on the registry scan's status: leftover index rows are still real sightings,
      // and recording one late only delays a 30-day signal. Full scans only (selectScanTasks).
      {
        name: 'archivePluginSkills',
        run: (db: Database.Database) => recordPluginSkillSightings(db, getArchive())
      },
      { name: 'runLinter', run: (db: Database.Database) => runLinter(db, identity) }
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
