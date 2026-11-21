import { isSuggestableFolder } from '../../../shared/grant-suggestions'
import {
  isHiddenProject,
  isWithinProjectPath,
  normalizeProjectPath
} from '../../../shared/project-path'
import type { AllowedPathRow } from '../../../shared/ipc'
import type { UsageProjectLocation } from '../../../shared/usage-projects'

export interface DetectedFolder {
  path: string
  label: string
}

// The folders Claude Code has run in that a grant could cover, shared by onboarding and Settings
// so the two lists never disagree. A folder nested inside another listed one (Claude Code run
// from a repo's subfolder) folds into its parent. A worktree's row is its repository's, so it is
// dropped only after folding, which keeps folders recorded inside it from surfacing as rows. A
// folder known to be gone can't be granted, so it leaves before folding.
export function detectedFolders(
  locations: (Pick<UsageProjectLocation, 'path' | 'worktree'> &
    Partial<Pick<UsageProjectLocation, 'status'>>)[],
  home: string,
  label: (path: string) => string
): DetectedFolder[] {
  const candidates = locations.filter(
    (location) => location.status !== 'missing' && isSuggestableFolder(location.path, home)
  )
  return candidates
    .filter(
      (location) =>
        !candidates.some(
          (other) =>
            normalizeProjectPath(other.path) !== normalizeProjectPath(location.path) &&
            isWithinProjectPath(location.path, other.path)
        )
    )
    .filter((location) => !location.worktree)
    .map((location) => ({ path: location.path, label: label(location.path) }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }))
}

// By grant coverage, not the scanned status: a fresh grant clears its rows at once, before the
// rescan it starts reports back. Hidden folders leave too; Usage alone still lists them.
export function ungrantedDetectedFolders(
  rows: DetectedFolder[],
  folders: AllowedPathRow[],
  hidden: readonly string[]
): DetectedFolder[] {
  return rows.filter(
    (row) =>
      !folders.some((folder) => isWithinProjectPath(row.path, folder.path)) &&
      !isHiddenProject(row.path, hidden)
  )
}
