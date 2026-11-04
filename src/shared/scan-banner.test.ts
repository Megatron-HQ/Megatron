import { describe, expect, it } from 'vitest'
import {
  SCAN_BANNER_READING,
  SCAN_BANNER_REVEAL_MS,
  SCAN_BANNER_SNAPSHOT,
  nextScanActivity,
  preferScanSummary,
  isMissingProjectOnlyScan,
  resolveScanBanner
} from './scan-banner'
import type { ScanIssue, ScanSourceSummary, ScanSummary } from './ipc'

describe('missing-project scan classification', () => {
  const missingSource: ScanSourceSummary = {
    name: 'scanSkills',
    status: 'partial',
    issues: [{ code: 'project_missing', path: 'C:/Old Projects/Megatron' }]
  }
  const summary: ScanSummary = {
    outcome: 'partial',
    completedAt: '2026-11-03T00:00:00.000Z',
    sources: [missingSource, { name: 'scanTranscripts', status: 'complete' }]
  }

  it('recognizes missing projects as informational while retaining their cached status', () => {
    expect(isMissingProjectOnlyScan(summary)).toBe(true)
    expect(
      resolveScanBanner({
        ...ready,
        scanning: false,
        hasPriorWarning: !isMissingProjectOnlyScan(summary)
      }).state
    ).toEqual({ kind: 'hidden' })
    expect(summary.sources[0].status).toBe('partial')
  })

  it.each<ScanIssue['code']>([
    'permission_required',
    'settings_invalid',
    'source_unavailable',
    'scan_limit'
  ])('keeps a mixed %s error actionable', (code) => {
    expect(
      isMissingProjectOnlyScan({
        ...summary,
        sources: [
          missingSource,
          { name: 'scanPluginRegistry', status: 'partial', issues: [{ code, path: 'C:/Projects' }] }
        ]
      })
    ).toBe(false)
  })

  it.each<ScanSourceSummary>([
    { name: 'scanWorker', status: 'failed', failureReason: 'timeout' },
    { name: 'scanWorker', status: 'failed', failureReason: 'worker_crash' },
    { name: 'scanSkills', status: 'partial' },
    { name: 'scanSkills', status: 'partial', issues: [] },
    { ...missingSource, status: 'failed' },
    { ...missingSource, failureReason: 'scan_error' }
  ])('does not hide an incomplete source without only missing-project issues: %j', (source) => {
    expect(isMissingProjectOnlyScan({ ...summary, sources: [missingSource, source] })).toBe(false)
  })

  it('does not mistake complete, failed, or unexplained summaries for missing projects', () => {
    expect(isMissingProjectOnlyScan({ ...summary, outcome: 'failed' })).toBe(false)
    expect(isMissingProjectOnlyScan({ ...summary, outcome: 'complete' })).toBe(false)
    expect(isMissingProjectOnlyScan({ ...summary, sources: [] })).toBe(false)
    expect(
      isMissingProjectOnlyScan({
        ...summary,
        sources: [{ name: 'scanSkills', status: 'complete' }]
      })
    ).toBe(false)
  })
})

const ready = {
  scanning: true,
  isStartup: true,
  elapsedMs: SCAN_BANNER_REVEAL_MS,
  skillsLoaded: true,
  pluginsLoaded: true,
  skillCount: 0,
  pluginCount: 0,
  lockedMessage: null,
  hasPriorWarning: false
}

describe('resolveScanBanner', () => {
  it.each([false, true])(
    'keeps later scans silent with prior warning=%s, even after a long delay',
    (hasPriorWarning) => {
      expect(
        resolveScanBanner({
          ...ready,
          isStartup: false,
          elapsedMs: 60_000,
          hasPriorWarning,
          lockedMessage: SCAN_BANNER_SNAPSHOT
        })
      ).toEqual({
        state: { kind: 'hidden' },
        lockedMessage: null
      })
    }
  )

  it('hides an earlier failure while the current startup scan is still running', () => {
    expect(
      resolveScanBanner({
        ...ready,
        elapsedMs: SCAN_BANNER_REVEAL_MS - 1,
        skillCount: 3,
        hasPriorWarning: true
      })
    ).toEqual({ state: { kind: 'hidden' }, lockedMessage: null })

    expect(
      resolveScanBanner({
        ...ready,
        skillsLoaded: false,
        skillCount: 3,
        hasPriorWarning: true
      })
    ).toEqual({ state: { kind: 'hidden' }, lockedMessage: null })

    expect(
      resolveScanBanner({
        ...ready,
        pluginsLoaded: false,
        hasPriorWarning: false
      })
    ).toEqual({ state: { kind: 'hidden' }, lockedMessage: null })
  })

  it('chooses the snapshot sentence when either list already has rows, and the reading sentence when both are empty', () => {
    expect(resolveScanBanner({ ...ready, skillCount: 2 })).toEqual({
      state: { kind: 'updating', message: SCAN_BANNER_SNAPSHOT },
      lockedMessage: SCAN_BANNER_SNAPSHOT
    })
    expect(resolveScanBanner({ ...ready, pluginCount: 1 })).toEqual({
      state: { kind: 'updating', message: SCAN_BANNER_SNAPSHOT },
      lockedMessage: SCAN_BANNER_SNAPSHOT
    })
    expect(resolveScanBanner(ready)).toEqual({
      state: { kind: 'updating', message: SCAN_BANNER_READING },
      lockedMessage: SCAN_BANNER_READING
    })
  })

  it('keeps the sentence chosen for this scan when later renders see different row counts', () => {
    expect(
      resolveScanBanner({
        ...ready,
        skillCount: 0,
        pluginCount: 0,
        lockedMessage: SCAN_BANNER_SNAPSHOT
      })
    ).toEqual({
      state: { kind: 'updating', message: SCAN_BANNER_SNAPSHOT },
      lockedMessage: SCAN_BANNER_SNAPSHOT
    })
  })

  it('holds a quiet refresh, warning included, until that refresh has run for 8 seconds', () => {
    const quiet = { ...ready, skillCount: 3, revealMs: 8_000 }

    expect(resolveScanBanner({ ...quiet, elapsedMs: 7_999, hasPriorWarning: true })).toEqual({
      state: { kind: 'hidden' },
      lockedMessage: null
    })
    expect(resolveScanBanner({ ...quiet, elapsedMs: 7_999, hasPriorWarning: false })).toEqual({
      state: { kind: 'hidden' },
      lockedMessage: null
    })
    expect(resolveScanBanner({ ...quiet, elapsedMs: 8_000, hasPriorWarning: true })).toEqual({
      state: { kind: 'updating', message: SCAN_BANNER_SNAPSHOT },
      lockedMessage: SCAN_BANNER_SNAPSHOT
    })
  })

  it('does not restore a completed manual scan warning at the top of the app', () => {
    expect(
      resolveScanBanner({ ...ready, scanning: false, isStartup: false, hasPriorWarning: true })
    ).toEqual({ state: { kind: 'hidden' }, lockedMessage: null })
  })

  it('drops the updating line as soon as the scan finishes, and brings a warning back only when the result still needs attention', () => {
    expect(
      resolveScanBanner({
        ...ready,
        scanning: false,
        lockedMessage: SCAN_BANNER_SNAPSHOT,
        hasPriorWarning: false
      })
    ).toEqual({ state: { kind: 'hidden' }, lockedMessage: null })

    expect(
      resolveScanBanner({
        ...ready,
        scanning: false,
        elapsedMs: SCAN_BANNER_REVEAL_MS - 1,
        hasPriorWarning: true
      })
    ).toEqual({ state: { kind: 'warning' }, lockedMessage: null })
  })
})

describe('nextScanActivity', () => {
  const quiet = { id: 1, startedAt: 1_000, revealMs: 8_000, isStartup: false }
  const announced = { id: 1, startedAt: 1_000, revealMs: 500, isStartup: false }

  it('ignores a delayed start from an older run while a newer run is active', () => {
    expect(nextScanActivity({ ...announced, id: 2 }, quiet)).toBeNull()
  })

  it('recognizes startup joining the same run without changing its reveal delay', () => {
    expect(nextScanActivity(announced, { ...announced, isStartup: true })).toEqual({
      ...announced,
      isStartup: true
    })
    expect(nextScanActivity({ ...announced, isStartup: true }, announced)).toBeNull()
  })

  it('adopts a shorter reveal for the same run and ignores a longer one', () => {
    expect(nextScanActivity(quiet, { ...announced, startedAt: 5_000 })).toEqual(announced)
    expect(nextScanActivity(announced, quiet)).toBeNull()
    expect(nextScanActivity(quiet, quiet)).toBeNull()
  })

  it('replaces the current run when the incoming activity has a different id', () => {
    expect(
      nextScanActivity(quiet, { id: 2, startedAt: 9_000, revealMs: 8_000, isStartup: false })
    ).toEqual({
      id: 2,
      startedAt: 9_000,
      revealMs: 8_000,
      isStartup: false
    })
    expect(nextScanActivity(null, announced)).toEqual(announced)
  })
})

describe('preferScanSummary', () => {
  const earlier = {
    outcome: 'partial' as const,
    completedAt: '2026-10-16T00:00:00.000Z',
    sources: []
  }
  const later = {
    outcome: 'partial' as const,
    completedAt: '2026-10-16T00:00:01.000Z',
    sources: [{ name: 'scanSkills', status: 'partial' as const }]
  }

  it('keeps the newer summary when a list refresh arrives after the scan-finished event', () => {
    expect(preferScanSummary(earlier, later)).toEqual(later)
    expect(preferScanSummary(later, earlier)).toEqual(later)
    expect(preferScanSummary(null, later)).toEqual(later)
    expect(preferScanSummary(earlier, undefined)).toEqual(earlier)
  })
})
