import { useRef, useState } from 'react'
import { normalizeProjectPath } from '../../../shared/project-path'
import type { SkippedGrant } from '../../../shared/ipc'
import { getFolderBasename } from './source-name'

export function skippedGrantMessage(entry: SkippedGrant): string {
  const name = getFolderBasename(entry.path)
  return normalizeProjectPath(entry.path) === normalizeProjectPath(entry.coveredBy)
    ? `${name} is already in the list.`
    : `${name} is already included in ${getFolderBasename(entry.coveredBy)}.`
}

// Every in-place "Add folder…" button runs the native picker through this, so each one reports a
// skipped pick or a failed call the same way instead of dropping the result.
export function useFolderGrant(onAddFolders: () => Promise<SkippedGrant[]>): {
  grant: () => Promise<void>
  pending: boolean
  skipped: SkippedGrant[]
  error: boolean
} {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(false)
  const [skipped, setSkipped] = useState<SkippedGrant[]>([])
  // State lags a render behind, so a double click could open two pickers without this.
  const inFlight = useRef(false)

  async function grant(): Promise<void> {
    if (inFlight.current) return
    inFlight.current = true
    setPending(true)
    setError(false)
    setSkipped([])
    try {
      setSkipped(await onAddFolders())
    } catch {
      setError(true)
    } finally {
      inFlight.current = false
      setPending(false)
    }
  }

  return { grant, pending, skipped, error }
}

// Hide and Show are display-only (hidden-projects.ts in main), so success needs no inline result:
// the row moves once the rescan main starts reports back, and a hide's toast says where to undo it.
export function useFolderAction(action: () => Promise<void>): {
  run: () => Promise<void>
  pending: boolean
  error: boolean
} {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(false)
  const inFlight = useRef(false)

  async function run(): Promise<void> {
    if (inFlight.current) return
    inFlight.current = true
    setPending(true)
    setError(false)
    try {
      await action()
    } catch {
      setError(true)
    } finally {
      inFlight.current = false
      setPending(false)
    }
  }

  return { run, pending, error }
}
