import type { ScanSummary } from './ipc'

export const SCAN_BANNER_REVEAL_MS = 500
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
  if (input.elapsedMs < SCAN_BANNER_REVEAL_MS || !listsReady) return held(input.hasPriorWarning)
  const message =
    input.skillCount > 0 || input.pluginCount > 0 ? SCAN_BANNER_SNAPSHOT : SCAN_BANNER_READING
  return { state: { kind: 'updating', message }, lockedMessage: message }
}
