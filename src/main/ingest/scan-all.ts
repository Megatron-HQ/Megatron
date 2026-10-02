import type Database from 'better-sqlite3'
import type { ScanSummary, ScanTaskResult } from '../../shared/ipc'

export type ScanTask = (db: Database.Database) => unknown
export type ScanErrorReporter = (error: unknown) => void

export function runAllScans(
  db: Database.Database,
  scans: ScanTask[],
  reportError: ScanErrorReporter = () => undefined
): ScanSummary {
  const sources: ScanSummary['sources'] = []
  for (const scan of scans) {
    try {
      const result = scan(db) as ScanTaskResult | undefined
      sources.push({
        name: scan.name || 'scan',
        status: result?.status === 'partial' ? 'partial' : 'complete'
      })
    } catch (error) {
      reportError(error)
      sources.push({ name: scan.name || 'scan', status: 'failed' })
    }
  }
  return {
    outcome: sources.every((source) => source.status === 'complete')
      ? 'complete'
      : sources.every((source) => source.status === 'failed')
        ? 'failed'
        : 'partial',
    completedAt: new Date().toISOString(),
    sources
  }
}
