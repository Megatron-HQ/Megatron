import { isAbsolute } from 'path'
import type { AllowedPathRow, SkippedGrant } from '../shared/ipc'
import { isWithinGrant } from './permissions'
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

export interface GrantChange {
  next: AllowedPathRow[]
  absorbed: string[]
  added: string[]
  skipped: SkippedGrant[]
}

// Grants never nest. A folder inside another grant is already readable through it, and storing it
// separately would let it outlive the parent's revocation as a grant the user no longer sees as
// distinct. Paths arrive canonical (canonicalGrantPath), so containment is purely lexical.
export function resolveGrantChange(
  existing: AllowedPathRow[],
  { add, remove = [] }: { add: string[]; remove?: string[] }
): GrantChange {
  const same = (a: string, b: string): boolean => isWithinGrant(a, b) && isWithinGrant(b, a)
  const unique = <T>(items: T[], path: (item: T) => string): T[] =>
    items.filter(
      (item, index) => items.findIndex((other) => same(path(other), path(item))) === index
    )
  const kept = unique(
    existing.filter((row) => !remove.some((path) => same(path, row.path))),
    (row) => row.path
  )
  const picks = unique(add, (path) => path)
  const grantedAt = new Date().toISOString()
  const candidates = [
    ...kept,
    ...picks
      .filter((path) => !kept.some((row) => same(row.path, path)))
      .map((path) => ({ path, granted_at: grantedAt }))
  ]
  const next = candidates.filter(
    (candidate) =>
      !candidates.some((other) => other !== candidate && isWithinGrant(candidate.path, other.path))
  )
  const survives = (path: string): boolean => next.some((row) => row.path === path)
  const added = candidates
    .slice(kept.length)
    .flatMap((row) => (survives(row.path) ? [row.path] : []))
  return {
    next,
    absorbed: kept.flatMap((row) => (survives(row.path) ? [] : [row.path])),
    added,
    skipped: picks
      .filter((path) => !added.includes(path))
      .map((path) => ({
        path,
        coveredBy: next.find((row) => isWithinGrant(path, row.path))!.path
      }))
  }
}

export function changeAllowedPaths(
  store: ThemeStore,
  change: { add: string[]; remove?: string[] }
): GrantChange {
  const result = resolveGrantChange(listAllowedPaths(store), change)
  store.set('grantedFolders', result.next)
  return result
}

// For grants saved before overlap was prevented. Runs before grants are restored into memory, so
// an absorbed child never becomes readable on its own.
export function normalizeAllowedPaths(store: ThemeStore): void {
  const existing = listAllowedPaths(store)
  const { next } = resolveGrantChange(existing, { add: [] })
  if (next.length !== existing.length) store.set('grantedFolders', next)
}
