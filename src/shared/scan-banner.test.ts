import { describe, expect, it } from 'vitest'
import {
  SCAN_BANNER_READING,
  SCAN_BANNER_REVEAL_MS,
  SCAN_BANNER_SNAPSHOT,
  preferScanSummary,
  resolveScanBanner
} from './scan-banner'

const ready = {
  scanning: true,
  elapsedMs: SCAN_BANNER_REVEAL_MS,
  skillsLoaded: true,
  pluginsLoaded: true,
  skillCount: 0,
  pluginCount: 0,
  lockedMessage: null,
  hasPriorWarning: false
}

describe('resolveScanBanner', () => {
  it('keeps a prior warning on screen until the scan has run long enough for both lists to have loaded', () => {
    expect(
      resolveScanBanner({
        ...ready,
        elapsedMs: SCAN_BANNER_REVEAL_MS - 1,
        skillCount: 3,
        hasPriorWarning: true
      })
    ).toEqual({ state: { kind: 'warning' }, lockedMessage: null })

    expect(
      resolveScanBanner({
        ...ready,
        skillsLoaded: false,
        skillCount: 3,
        hasPriorWarning: true
      })
    ).toEqual({ state: { kind: 'warning' }, lockedMessage: null })

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
