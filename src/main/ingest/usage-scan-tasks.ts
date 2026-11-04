import type Database from 'better-sqlite3'
import type { ScanTaskResult } from '../../shared/ipc'
import { archiveUsageHistory } from './usage-history'
import type { ScanTask } from './scan-all'

export function createUsageScanTasks(dependencies: {
  scanTranscripts: (database: Database.Database) => ScanTaskResult
  scanPromptHistory: (database: Database.Database) => ScanTaskResult
  getArchive: () => Database.Database
}): ScanTask[] {
  let transcriptsComplete = false
  let promptsComplete = false

  function scanTranscripts(database: Database.Database): ScanTaskResult {
    const result = dependencies.scanTranscripts(database)
    transcriptsComplete = result.status === 'complete'
    return result
  }

  function archiveTokens(database: Database.Database): ScanTaskResult {
    if (!transcriptsComplete) return { status: 'partial' }
    archiveUsageHistory(database, dependencies.getArchive(), { prompts: false, tokens: true })
    return { status: 'complete' }
  }

  function scanPromptHistory(database: Database.Database): ScanTaskResult {
    const result = dependencies.scanPromptHistory(database)
    promptsComplete = result.status === 'complete'
    return result
  }

  function archivePrompts(database: Database.Database): ScanTaskResult {
    if (!promptsComplete) return { status: 'partial' }
    archiveUsageHistory(database, dependencies.getArchive(), { prompts: true, tokens: false })
    return { status: 'complete' }
  }

  return [
    { name: 'scanTranscripts', run: scanTranscripts },
    { name: 'archiveTokens', run: archiveTokens },
    { name: 'scanPromptHistory', run: scanPromptHistory },
    { name: 'archivePrompts', run: archivePrompts }
  ]
}
