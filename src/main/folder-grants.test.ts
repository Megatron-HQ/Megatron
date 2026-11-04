import Store from 'electron-store'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { addAllowedPath, listAllowedPaths, removeAllowedPath } from './folder-grants'
import type { ThemeStore } from './theme'

let tempDir: string
let store: ThemeStore

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'megatron-grants-test-'))
  store = new Store({ name: 'preferences', cwd: tempDir })
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

describe('listAllowedPaths', () => {
  it('returns an empty array when no paths are allowed', () => {
    expect(listAllowedPaths(store)).toEqual([])
  })

  it('returns stored grants ordered by granted_at', () => {
    const a = resolve('/path/to/repo-a')
    const b = resolve('/path/to/repo-b')
    store.set('grantedFolders', [
      { path: b, granted_at: '2026-02-01T00:00:00.000Z' },
      { path: a, granted_at: '2026-01-01T00:00:00.000Z' }
    ])
    expect(listAllowedPaths(store)).toEqual([
      { path: a, granted_at: '2026-01-01T00:00:00.000Z' },
      { path: b, granted_at: '2026-02-01T00:00:00.000Z' }
    ])
  })

  it('drops malformed entries instead of granting them', () => {
    const valid = { path: resolve('/path/to/repo'), granted_at: '2026-01-01T00:00:00.000Z' }
    store.set('grantedFolders', [
      null,
      'not-an-object',
      { path: 'relative/path', granted_at: '2026-01-01T00:00:00.000Z' },
      { path: 42, granted_at: '2026-01-01T00:00:00.000Z' },
      { path: resolve('/no/timestamp') },
      { path: `${resolve('/nul')}\0`, granted_at: '2026-01-01T00:00:00.000Z' },
      valid
    ] as never)
    expect(listAllowedPaths(store)).toEqual([valid])
  })

  it('treats a non-array value as no grants', () => {
    store.set('grantedFolders', { path: resolve('/path/to/repo') } as never)
    expect(listAllowedPaths(store)).toEqual([])
  })
})

describe('addAllowedPath', () => {
  it('stores a resolved path with an ISO8601 timestamp', () => {
    addAllowedPath(store, '/path/to/../to/repo')
    const rows = listAllowedPaths(store)
    expect(rows).toHaveLength(1)
    expect(rows[0].path).toBe(resolve('/path/to/repo'))
    expect(new Date(rows[0].granted_at).toISOString()).toBe(rows[0].granted_at)
  })

  it('refreshes granted_at instead of duplicating an existing grant', () => {
    const p = resolve('/path/to/repo')
    store.set('grantedFolders', [{ path: p, granted_at: '2020-01-01T00:00:00.000Z' }])
    addAllowedPath(store, p)
    const rows = listAllowedPaths(store)
    expect(rows).toHaveLength(1)
    expect(rows[0].granted_at).not.toBe('2020-01-01T00:00:00.000Z')
  })

  it('survives a fresh store instance reading the same file', () => {
    addAllowedPath(store, '/path/to/repo')
    const reopened: ThemeStore = new Store({ name: 'preferences', cwd: tempDir })
    expect(listAllowedPaths(reopened).map((row) => row.path)).toEqual([resolve('/path/to/repo')])
  })
})

describe('removeAllowedPath', () => {
  it('deletes only the named grant', () => {
    const a = resolve('/path/to/repo-a')
    const b = resolve('/path/to/repo-b')
    addAllowedPath(store, a)
    addAllowedPath(store, b)

    removeAllowedPath(store, a)
    expect(listAllowedPaths(store).map((row) => row.path)).toEqual([b])
  })

  it('no-ops when removing a path that was never granted', () => {
    addAllowedPath(store, '/path/to/repo-a')
    expect(() => removeAllowedPath(store, '/path/to/repo-b')).not.toThrow()
    expect(listAllowedPaths(store)).toHaveLength(1)
  })
})
