import type { ScanActivity } from '../shared/ipc'

export type ScanRun = ScanActivity

export function createScanSession(): {
  begin: (now: number) => { run: ScanRun; started: boolean }
  end: () => ScanRun | null
  current: () => ScanRun | null
} {
  let depth = 0
  let current: ScanRun | null = null
  let nextId = 1

  return {
    begin(now: number): { run: ScanRun; started: boolean } {
      const started = current === null
      if (current === null) current = { id: nextId++, startedAt: now }
      depth++
      return { run: current, started }
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
