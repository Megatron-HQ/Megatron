import type { ScanActivity } from '../shared/ipc'
import { SCAN_BANNER_QUIET_REVEAL_MS, SCAN_BANNER_REVEAL_MS } from '../shared/scan-banner'

export type ScanUrgency = 'announce' | 'quiet'
export type ScanRun = ScanActivity

export function createScanSession(): {
  begin: (
    now: number,
    urgency?: ScanUrgency
  ) => { run: ScanRun; started: boolean; promoted: boolean }
  end: () => ScanRun | null
  current: () => ScanRun | null
} {
  let depth = 0
  let current: ScanRun | null = null
  let nextId = 1

  return {
    begin(
      now: number,
      urgency: ScanUrgency = 'announce'
    ): {
      run: ScanRun
      started: boolean
      promoted: boolean
    } {
      const started = current === null
      let promoted = false
      if (current === null) {
        current = {
          id: nextId++,
          startedAt: now,
          revealMs: urgency === 'quiet' ? SCAN_BANNER_QUIET_REVEAL_MS : SCAN_BANNER_REVEAL_MS
        }
      } else if (urgency === 'announce' && current.revealMs > SCAN_BANNER_REVEAL_MS) {
        current = { ...current, revealMs: SCAN_BANNER_REVEAL_MS }
        promoted = true
      }
      depth++
      return { run: current, started, promoted }
    },
    end(): ScanRun | null {
      if (depth === 0 || current === null) return null
      depth--
      if (depth > 0) return null
      const finished = current
      current = null
      return finished
    },
    current(): ScanRun | null {
      return current
    }
  }
}
