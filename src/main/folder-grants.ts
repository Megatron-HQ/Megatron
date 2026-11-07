import { isAbsolute, resolve } from 'path'
import type { AllowedPathRow } from '../shared/ipc'
import type { ThemeStore } from './theme'

// Grants live in preferences, not the index: megatron.db is rebuilt whenever schema.sql changes,
// and no scan can rediscover a folder the user picked by hand.

// preferences.json is a plain file on disk, and every entry here widens file access. A relative
// path would resolve against the process cwd and grant it, so anything malformed is dropped.
function isGrant(entry: unknown): entry is AllowedPathRow {
  if (entry === null || typeof entry !== 'object') return false
  const { path, granted_at } = entry as Record<string, unknown>
  return (
    typeof path === 'string' &&
    isAbsolute(path) &&
    !path.includes('\0') &&
    typeof granted_at === 'string'
  )
}

export function listAllowedPaths(store: ThemeStore): AllowedPathRow[] {
  const stored: unknown = store.get('grantedFolders')
  if (!Array.isArray(stored)) return []
  return stored
    .filter(isGrant)
    .map(({ path, granted_at }) => ({ path, granted_at }))
    .sort((a, b) => (a.granted_at < b.granted_at ? -1 : a.granted_at > b.granted_at ? 1 : 0))
}

export function addAllowedPath(store: ThemeStore, path: string): void {
  const resolved = resolve(path)
  store.set('grantedFolders', [
    ...listAllowedPaths(store).filter((row) => row.path !== resolved),
    { path: resolved, granted_at: new Date().toISOString() }
  ])
}

export function removeAllowedPath(store: ThemeStore, path: string): void {
  const resolved = resolve(path)
  store.set(
    'grantedFolders',
    listAllowedPaths(store).filter((row) => row.path !== resolved)
  )
}
