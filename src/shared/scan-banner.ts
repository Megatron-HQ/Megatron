import type { ScanActivity, ScanSummary } from './ipc'

export const SCAN_BANNER_REVEAL_MS = 500
export const SCAN_BANNER_QUIET_REVEAL_MS = 8_000
export const SCAN_BANNER_SNAPSHOT = 'Updating your index. This is the last saved snapshot.'
export const SCAN_BANNER_READING = 'Reading your Claude Code files.'

export type ScanBannerState =
  { kind: 'hidden' } | { kind: 'warning' } | { kind: 'updating'; message: string }

export interface ScanBannerInput {
  scanning: boolean
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

export function nextScanActivity(
  current: ScanActivity | null,
  incoming: ScanActivity
): ScanActivity | null {
  if (current === null || current.id !== incoming.id) return incoming
  if (incoming.revealMs < current.revealMs) return { ...current, revealMs: incoming.revealMs }
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
  if (!input.scanning) return held(input.hasPriorWarning)
  if (input.lockedMessage !== null) {
    return {
      state: { kind: 'updating', message: input.lockedMessage },
      lockedMessage: input.lockedMessage
    }
  }
  const listsReady = input.skillsLoaded && input.pluginsLoaded
  const revealMs = input.revealMs ?? SCAN_BANNER_REVEAL_MS
  if (input.elapsedMs < revealMs || !listsReady) return held(input.hasPriorWarning)
  const message =
    input.skillCount > 0 || input.pluginCount > 0 ? SCAN_BANNER_SNAPSHOT : SCAN_BANNER_READING
  return { state: { kind: 'updating', message }, lockedMessage: message }
}
