import type Database from 'better-sqlite3'
import { describe, expect, it, vi } from 'vitest'
import { runAllScans, type ScanTask } from './scan-all'

const database = {} as Database.Database

describe('runAllScans', () => {
  it('runs every scan task in order', () => {
    const calls: string[] = []
    const scans: ScanTask[] = [
      () => calls.push('skills'),
      () => calls.push('plugins'),
      () => calls.push('transcripts'),
      () => calls.push('linter')
    ]

    runAllScans(database, scans)

    expect(calls).toEqual(['skills', 'plugins', 'transcripts', 'linter'])
  })

  it('continues scanning after one task fails and reports that failure', () => {
    const error = new Error('unreadable source')
    const reportError = vi.fn()
    const succeedingScan = vi.fn()
    const scans: ScanTask[] = [
      () => {
        throw error
      },
      succeedingScan
    ]

    runAllScans(database, scans, reportError)

    expect(reportError).toHaveBeenCalledWith(error)
    expect(succeedingScan).toHaveBeenCalledWith(database)
  })
})
