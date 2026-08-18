import type Database from 'better-sqlite3'

export type ScanTask = (db: Database.Database) => void
export type ScanErrorReporter = (error: unknown) => void

export function runAllScans(
  db: Database.Database,
  scans: ScanTask[],
  reportError: ScanErrorReporter = () => undefined
): void {
  for (const scan of scans) {
    try {
      scan(db)
    } catch (error) {
      reportError(error)
    }
  }
}
