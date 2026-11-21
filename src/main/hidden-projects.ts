import { isAbsolute } from 'path'
import { isWithinProjectPath, normalizeProjectPath } from '../shared/project-path'
import type { ThemeStore } from './theme'

// Display-only: a hidden folder drops out of the index at scan time, never out of access. It lives
// in preferences, not the index, so it survives db:reset like the grants do.

const MAX_PATH_LENGTH = 8192
const MAX_HIDDEN = 1000

const same = (a: string, b: string): boolean => normalizeProjectPath(a) === normalizeProjectPath(b)

export function readHiddenProjects(store: ThemeStore): string[] {
  const stored: unknown = store.get('hiddenProjects')
  if (!Array.isArray(stored)) return []
  const hidden: string[] = []
  for (const entry of stored) {
    if (
      typeof entry !== 'string' ||
      !isAbsolute(entry) ||
      entry.length > MAX_PATH_LENGTH ||
      entry.includes('\0') ||
      hidden.some((path) => same(path, entry))
    )
      continue
    hidden.push(entry)
    if (hidden.length === MAX_HIDDEN) break
  }
  return hidden
}

export function hideProject(store: ThemeStore, path: string): string[] {
  const hidden = readHiddenProjects(store)
  if (hidden.some((entry) => same(entry, path))) return hidden
  if (hidden.length >= MAX_HIDDEN) throw new Error('Too many hidden folders')
  const next = [...hidden, path]
  store.set('hiddenProjects', next)
  return next
}

// Only a folder the user can see in the Hidden list can be shown, as narrowing needs a grant.
export function showProject(store: ThemeStore, path: string): string[] {
  const hidden = readHiddenProjects(store)
  if (!hidden.some((entry) => same(entry, path))) throw new Error('Folder is not hidden')
  const next = hidden.filter((entry) => !same(entry, path))
  store.set('hiddenProjects', next)
  return next
}

// Picking a hidden folder, or one inside it, is asking to see it. A parent pick is not: hiding a
// child of a granted folder is the only way to keep it out of view.
export function unhideForPicks(store: ThemeStore, picks: string[]): string[] {
  const hidden = readHiddenProjects(store)
  const next = hidden.filter((entry) => !picks.some((pick) => isWithinProjectPath(pick, entry)))
  if (next.length !== hidden.length) store.set('hiddenProjects', next)
  return next
}
