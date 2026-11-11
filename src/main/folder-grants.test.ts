import Store from 'electron-store'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  changeAllowedPaths,
  listAllowedPaths,
  normalizeAllowedPaths,
  resolveGrantChange
} from './folder-grants'
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

const desktop = resolve('/Users/me/Desktop')
const megatron = resolve('/Users/me/Desktop/Megatron')
const api = resolve('/Users/me/Desktop/api')
const other = resolve('/Users/me/code/other')
const row = (path: string, granted_at: string): { path: string; granted_at: string } => ({
  path,
  granted_at
})

describe('resolveGrantChange', () => {
  it('absorbs stored grants inside a newly added parent and keeps unrelated ones as stored', () => {
    const change = resolveGrantChange(
      [row(megatron, '2026-01-01'), row(api, '2026-01-02'), row(other, '2026-01-03')],
      { add: [desktop] }
    )
    expect(change.next).toEqual([row(other, '2026-01-03'), row(desktop, expect.any(String))])
    expect(new Date(change.next[1].granted_at).toISOString()).toBe(change.next[1].granted_at)
    expect(change.absorbed).toEqual([megatron, api])
    expect(change.added).toEqual([desktop])
    expect(change.skipped).toEqual([])
  })

  it('skips a pick already covered by a stored grant', () => {
    const change = resolveGrantChange([row(desktop, '2026-01-01')], { add: [megatron] })
    expect(change.next).toEqual([row(desktop, '2026-01-01')])
    expect(change.added).toEqual([])
    expect(change.skipped).toEqual([{ path: megatron, coveredBy: desktop }])
  })

  it('keeps the original grant date when a stored grant is picked again', () => {
    const change = resolveGrantChange([row(desktop, '2026-01-01')], { add: [desktop] })
    expect(change.next).toEqual([row(desktop, '2026-01-01')])
    expect(change.added).toEqual([])
    expect(change.skipped).toEqual([{ path: desktop, coveredBy: desktop }])
  })

  it('resolves a parent and its child picked together to the parent', () => {
    const change = resolveGrantChange([], { add: [megatron, desktop, desktop] })
    expect(change.next.map((grant) => grant.path)).toEqual([desktop])
    expect(change.added).toEqual([desktop])
    expect(change.skipped).toEqual([{ path: megatron, coveredBy: desktop }])
  })

  it('keeps a grant that only shares a name prefix with the new one', () => {
    const sibling = resolve('/Users/me/Desktop/Megatron-2')
    const change = resolveGrantChange([row(sibling, '2026-01-01')], { add: [megatron] })
    expect(change.next.map((grant) => grant.path)).toEqual([sibling, megatron])
    expect(change.absorbed).toEqual([])
  })

  // A link inside Desktop may point at an external volume; that target is a separate grant.
  it('keeps a grant outside the new parent even if a link inside the parent reaches it', () => {
    const external = resolve('/Volumes/External/project')
    const change = resolveGrantChange([row(external, '2026-01-01')], { add: [desktop] })
    expect(change.next.map((grant) => grant.path)).toEqual([external, desktop])
  })

  it('treats paths that differ only by case as the same folder on win32', () => {
    const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
    Object.defineProperty(process, 'platform', { value: 'win32' })
    try {
      const change = resolveGrantChange([row(resolve('/Users/Me/Desktop/Repo'), '2026-01-01')], {
        add: [resolve('/users/me/desktop')]
      })
      expect(change.absorbed).toEqual([resolve('/Users/Me/Desktop/Repo')])
      expect(change.next.map((grant) => grant.path)).toEqual([resolve('/users/me/desktop')])
    } finally {
      Object.defineProperty(process, 'platform', platform)
    }
  })

  it('removes only the named grant', () => {
    const change = resolveGrantChange([row(desktop, '2026-01-01'), row(other, '2026-01-02')], {
      add: [],
      remove: [desktop]
    })
    expect(change.next).toEqual([row(other, '2026-01-02')])
  })

  it('replaces a removed parent with the children picked inside it', () => {
    const change = resolveGrantChange([row(desktop, '2026-01-01')], {
      add: [megatron, api],
      remove: [desktop]
    })
    expect(change.next.map((grant) => grant.path)).toEqual([megatron, api])
    expect(change.added).toEqual([megatron, api])
    expect(change.absorbed).toEqual([])
    expect(change.skipped).toEqual([])
  })

  it.each([
    ['outside it', other, [other]],
    ['containing it', resolve('/Users/me'), [resolve('/Users/me')]],
    ['equal to it', desktop, [desktop]]
  ])('applies a replacement pick %s as a plain add', (_label, pick, expected) => {
    const change = resolveGrantChange([row(desktop, '2026-01-01')], {
      add: [pick],
      remove: [desktop]
    })
    expect(change.next.map((grant) => grant.path)).toEqual(expected)
    expect(change.added).toEqual(expected)
  })
})

describe('changeAllowedPaths', () => {
  it('persists the resolved grants for a fresh store instance', () => {
    store.set('grantedFolders', [row(megatron, '2026-01-01T00:00:00.000Z')])
    const change = changeAllowedPaths(store, { add: [desktop] })
    expect(change.absorbed).toEqual([megatron])
    const reopened: ThemeStore = new Store({ name: 'preferences', cwd: tempDir })
    expect(listAllowedPaths(reopened).map((grant) => grant.path)).toEqual([desktop])
  })
})

describe('normalizeAllowedPaths', () => {
  it('collapses grants saved before overlap was prevented into their outermost folder', () => {
    store.set('grantedFolders', [
      row(megatron, '2026-01-01T00:00:00.000Z'),
      row(desktop, '2026-01-02T00:00:00.000Z'),
      row(other, '2026-01-03T00:00:00.000Z')
    ])
    normalizeAllowedPaths(store)
    expect(listAllowedPaths(store)).toEqual([
      row(desktop, '2026-01-02T00:00:00.000Z'),
      row(other, '2026-01-03T00:00:00.000Z')
    ])
  })

  it('leaves preferences unwritten when no grants overlap', () => {
    store.set('grantedFolders', [row(desktop, '2026-01-01T00:00:00.000Z')])
    const write = vi.spyOn(store, 'set')
    normalizeAllowedPaths(store)
    expect(write).not.toHaveBeenCalled()
  })
})
