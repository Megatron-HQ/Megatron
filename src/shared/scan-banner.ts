import type { ScanActivity, ScanSummary } from './ipc'

export const SCAN_BANNER_REVEAL_MS = 500
export const SCAN_BANNER_QUIET_REVEAL_MS = 8_000
export const SCAN_BANNER_SNAPSHOT = 'Refreshing Claude Code data…'
export const SCAN_BANNER_READING = 'Scanning Claude Code data…'

export type ScanBannerState =
  { kind: 'hidden' } | { kind: 'warning' } | { kind: 'updating'; message: string }

export interface ScanBannerInput {
  scanning: boolean
  isStartup: boolean
  elapsedMs: number
  skillsLoaded: boolean
  pluginsLoaded: boolean
  skillCount: number
  pluginCount: number
  lockedMessage: string | null
  hasPriorWarning: boolean
  // Absent means the announced-scan wait. A focus refresh passes the longer quiet wait.
  revealMs?: number
}

export function isMissingProjectOnlyScan(summary: ScanSummary): boolean {
  if (summary.outcome !== 'partial') return false
  const affectedSources = summary.sources.filter((source) => source.status !== 'complete')
  return (
    affectedSources.length > 0 &&
    affectedSources.every(
      (source) =>
        source.status === 'partial' &&
        source.failureReason === undefined &&
        source.issues !== undefined &&
        source.issues.length > 0 &&
        source.issues.every((issue) => issue.code === 'project_missing')
    )
  )
}

export function nextScanActivity(
  current: ScanActivity | null,
  incoming: ScanActivity
): ScanActivity | null {
  if (current !== null && incoming.id < current.id) return null
  if (current === null || current.id !== incoming.id) return incoming
  if (incoming.revealMs < current.revealMs || (incoming.isStartup && !current.isStartup)) {
    return {
      ...current,
      isStartup: current.isStartup || incoming.isStartup,
      revealMs: Math.min(current.revealMs, incoming.revealMs)
    }
  }
  return null
}

export function preferScanSummary(
  finished: ScanSummary | null | undefined,
  reported: ScanSummary | null | undefined
): ScanSummary | undefined {
  if (!finished) return reported ?? undefined
  if (!reported) return finished
  return finished.completedAt >= reported.completedAt ? finished : reported
}

function held(hasPriorWarning: boolean): {
  state: ScanBannerState
  lockedMessage: string | null
} {
  return {
    state: hasPriorWarning ? { kind: 'warning' } : { kind: 'hidden' },
    lockedMessage: null
  }
}

export function resolveScanBanner(input: ScanBannerInput): {
  state: ScanBannerState
  lockedMessage: string | null
} {
  if (!input.isStartup) return held(false)
  if (!input.scanning) return held(input.hasPriorWarning)
  if (input.lockedMessage !== null) {
    return {
      state: { kind: 'updating', message: input.lockedMessage },
      lockedMessage: input.lockedMessage
    }
  }
  const listsReady = input.skillsLoaded && input.pluginsLoaded
  const revealMs = input.revealMs ?? SCAN_BANNER_REVEAL_MS
  if (input.elapsedMs < revealMs || !listsReady) return held(false)
  const message =
    input.skillCount > 0 || input.pluginCount > 0 ? SCAN_BANNER_SNAPSHOT : SCAN_BANNER_READING
  return { state: { kind: 'updating', message }, lockedMessage: message }
}
