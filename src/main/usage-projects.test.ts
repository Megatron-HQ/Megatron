import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import {
  reconcileUsageProjects,
  linkUsageProjects,
  unlinkUsageProject,
  usageProjectCatalog,
  readClaudeAppChats,
  refreshUsageProjectAvailability
} from './usage-projects'
import { applySchema } from './db/schema'
import { openUsageArchive } from './db/usage-archive'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { grantPath, resetGrantedPaths } from './permissions'
import {
  resolveUsageProjectPath,
  groupProjectCounts,
  groupProjectMonths,
  groupProjectTokens,
  groupProjectSpending,
  matchesUsageProjectSearch
} from '../shared/usage-projects'
import type { ProjectFolder } from '../shared/ipc'

const repository = (path: string): ProjectFolder => ({
  path,
  kind: 'repository',
  status: 'available'
})

describe('persistent Usage project identities', () => {
  it('finds retained Windows locations using an earlier disambiguated label or either separator', () => {
    expect(
      matchesUsageProjectSearch('Megatron HQ/Megatron', ['Megatron', 'C:\\Megatron HQ\\Megatron'])
    ).toBe(true)
    expect(matchesUsageProjectSearch(' c:/MEGATRON ', ['C:\\Megatron'])).toBe(true)
    expect(matchesUsageProjectSearch('Site', ['Megatron', 'C:\\Megatron HQ\\Megatron'])).toBe(false)
  })
  it('groups Windows path variants and subfolders under the nearest repository', () => {
    const locations = reconcileUsageProjects(
      [],
      [repository('C:\\HQ\\Megatron'), repository('C:\\HQ\\Megatron\\Child')],
      ['c:/hq/megatron/src/', 'C:\\HQ\\Megatron\\Child\\src']
    )
    expect(locations).toHaveLength(2)
    expect(
      groupProjectCounts(
        [
          { project: 'c:/HQ/Megatron/', count: 3 },
          { project: 'C:\\HQ\\Megatron\\src', count: 5 },
          { project: 'C:\\HQ\\Megatron\\Child\\src', count: 2 }
        ],
        locations
      )
    ).toEqual([
      { project: 'C:\\HQ\\Megatron', count: 8 },
      { project: 'C:\\HQ\\Megatron\\Child', count: 2 }
    ])
  })

  it('retains historical roots and their IDs when discovery loses access or removes them', () => {
    const first = reconcileUsageProjects([], [repository('C:\\HQ\\Megatron')], [])
    const later = reconcileUsageProjects(
      JSON.parse(JSON.stringify(first)),
      [],
      ['C:\\HQ\\Megatron\\src']
    )
    expect(later).toHaveLength(1)
    expect(later[0].id).toBe(first[0].id)
    expect(later[0].status).toBe('needs_access')
    expect(resolveUsageProjectPath('c:/hq/megatron/src', later)).toBe('C:\\HQ\\Megatron')
  })

  it('combines confirmed moves reversibly without assigning parent-folder activity to a child', () => {
    const initial = reconcileUsageProjects(
      [],
      [repository('C:\\HQ\\Megatron'), repository('C:\\HQ\\Megatron-site')],
      ['C:\\Megatron', 'C:\\HQ']
    )
    const old = initial.find((entry) => entry.path === 'C:\\Megatron')!
    const current = initial.find((entry) => entry.path === 'C:\\HQ\\Megatron')!
    const linked = linkUsageProjects(initial, old.id, current.id)
    const counts = [
      { project: old.path, count: 29 },
      { project: current.path, count: 13 },
      { project: 'C:\\HQ', count: 4 }
    ]
    expect(groupProjectCounts(counts, linked)).toEqual([
      { project: current.path, count: 42 },
      { project: 'C:\\HQ', count: 4 }
    ])
    expect(groupProjectCounts(counts, unlinkUsageProject(linked, old.id))).toEqual([
      { project: old.path, count: 29 },
      { project: current.path, count: 13 },
      { project: 'C:\\HQ', count: 4 }
    ])
    expect(initial.find((entry) => entry.id === old.id)?.linkedTo).toBeUndefined()
    expect(linked.find((entry) => entry.id === old.id)?.path).toBe(old.path)
  })

  it('keeps clones separate and offers matching names as suggestions instead of merging', () => {
    const locations = reconcileUsageProjects(
      [],
      [repository('/work/repo'), repository('/copy/repo')],
      []
    )
    const catalog = usageProjectCatalog(locations)
    expect(catalog.projects.map((project) => project.label).sort()).toEqual([
      'copy/repo',
      'work/repo'
    ])
    expect(catalog.projects[0].possibleMatches).toEqual([catalog.projects[1].id])
    expect(
      groupProjectCounts(
        [
          { project: '/work/repo', count: 1 },
          { project: '/copy/repo', count: 2 }
        ],
        locations
      )
    ).toHaveLength(2)
  })

  it('updates fallback ownership when a repository is first discovered without merging nested repositories', () => {
    const historical = reconcileUsageProjects([], [], ['/work/repo/src', '/work/repo/child/src'])
    const discovered = reconcileUsageProjects(
      historical,
      [repository('/work/repo'), repository('/work/repo/child')],
      []
    )
    expect(resolveUsageProjectPath('/work/repo/src', discovered)).toBe('/work/repo')
    expect(resolveUsageProjectPath('/work/repo/child/src', discovered)).toBe('/work/repo/child')
    expect(() => unlinkUsageProject(discovered, historical[0].id)).toThrow()
  })

  it('reassigns inferred subfolders when a deeper repository is discovered later', () => {
    const initial = reconcileUsageProjects([], [], ['/work/repo/child/src'])
    const parent = reconcileUsageProjects(initial, [repository('/work/repo')], [])
    expect(resolveUsageProjectPath('/work/repo/child/src', parent)).toBe('/work/repo')
    const nested = reconcileUsageProjects(
      parent,
      [repository('/work/repo'), repository('/work/repo/child')],
      []
    )
    expect(resolveUsageProjectPath('/work/repo/child/src', nested)).toBe('/work/repo/child')
  })

  it('uses a confirmed historical location as a root for subsequently observed subfolders', () => {
    const locations = reconcileUsageProjects([], [repository('/current/repo')], ['/previous/repo'])
    const old = locations.find((entry) => entry.path === '/previous/repo')!
    const current = locations.find((entry) => entry.path === '/current/repo')!
    const linked = linkUsageProjects(locations, old.id, current.id)
    expect(resolveUsageProjectPath('/previous/repo/src', linked)).toBe('/current/repo')
    expect(resolveUsageProjectPath('/previous/repository', linked)).toBe('/previous/repository')
  })

  it('preserves POSIX case and directory boundaries', () => {
    const locations = reconcileUsageProjects(
      [],
      [repository('/work/Repo'), repository('/work/repo')],
      ['/work/repository']
    )
    expect(resolveUsageProjectPath('/work/Repo/src', locations)).toBe('/work/Repo')
    expect(resolveUsageProjectPath('/work/repo/src', locations)).toBe('/work/repo')
    expect(resolveUsageProjectPath('/work/repository', locations)).toBe('/work/repository')
  })

  it('rejects unknown identities and prevents cyclic or self links', () => {
    const locations = reconcileUsageProjects([], [repository('/a'), repository('/b')], [])
    expect(() => linkUsageProjects(locations, 'unknown', locations[0].id)).toThrow()
    expect(() => linkUsageProjects(locations, locations[0].id, locations[0].id)).toThrow()
    const linked = linkUsageProjects(locations, locations[0].id, locations[1].id)
    expect(() => linkUsageProjects(linked, locations[1].id, locations[0].id)).toThrow()
    expect(() => unlinkUsageProject(locations, 'unknown')).toThrow()
  })

  it('recovers malformed saved metadata without adopting invalid links or duplicate paths', () => {
    const locations = reconcileUsageProjects(
      [
        {
          id: 'one',
          path: 'C:\\Repo',
          kind: 'repository',
          status: 'available',
          linkedTo: 'missing'
        },
        { id: 'two', path: 'c:/repo/', kind: 'repository', status: 'available' },
        { id: 'bad', path: null },
        { id: 'relative', path: 'repo', kind: 'folder', status: 'available' }
      ],
      [],
      []
    )
    expect(locations).toHaveLength(1)
    expect(locations[0].id).toBe('one')
    expect(locations[0].linkedTo).toBeUndefined()
  })

  it('combines every month and token category while keeping source rows unchanged', () => {
    const locations = reconcileUsageProjects([], [repository('/repo')], [])
    const months = [
      { project: '/repo/a', total: 3, byMonth: [1, 2, ...Array(10).fill(0)] },
      { project: '/repo/b', total: 7, byMonth: [3, 4, ...Array(10).fill(0)] }
    ]
    expect(groupProjectMonths(months, locations)).toEqual([
      { project: '/repo', total: 10, byMonth: [4, 6, ...Array(10).fill(0)] }
    ])
    expect(months[0].byMonth[0]).toBe(1)
    expect(
      groupProjectTokens(
        [
          {
            key: '/repo/a',
            tokens: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 10 }
          },
          {
            key: '/repo/b',
            tokens: { input: 5, output: 6, cacheRead: 7, cacheWrite: 8, total: 26 }
          }
        ],
        locations
      )
    ).toEqual([
      { key: '/repo', tokens: { input: 6, output: 8, cacheRead: 10, cacheWrite: 12, total: 36 } }
    ])
  })

  it('combines cost shares without changing recorded spend', () => {
    const locations = reconcileUsageProjects([], [repository('/repo')], [])
    expect(
      groupProjectSpending(
        [
          { project: '/repo/a', costUsd: 1.25 },
          { project: '/repo/b', costUsd: 2.75 }
        ],
        locations
      )
    ).toEqual([{ project: '/repo', costUsd: 4 }])
  })

  it('distinguishes a missing granted folder from an ungranted historical location', () => {
    const directory = mkdtempSync(join(tmpdir(), 'usage-project-availability-'))
    try {
      grantPath(directory)
      writeFileSync(join(directory, 'one.txt'), 'one')
      writeFileSync(join(directory, 'two.txt'), 'two')
      const locations = reconcileUsageProjects(
        [],
        [
          repository(directory),
          repository(join(directory, 'removed')),
          repository('C:\\private-ungranted-project')
        ],
        []
      )
      expect(refreshUsageProjectAvailability(locations).map((entry) => entry.status)).toEqual([
        'available',
        'missing',
        'needs_access'
      ])
    } finally {
      resetGrantedPaths()
      rmSync(directory, { recursive: true, force: true })
    }
  })
})

describe('Claude app chats', () => {
  const chats = '/Users/sai/Library/Application Support/Claude/scratch-workspaces/a/b'
  const renamed = `${chats}/scratch-2026-11-06-0f5802`
  const pruned = `${chats}/scratch-2026-10-07-4f09d6`

  it('reads each chat title from its newest titled transcript and its earliest known start', () => {
    const directory = mkdtempSync(join(tmpdir(), 'megatron-chats-'))
    const index = new Database(':memory:')
    applySchema(index)
    const archive = openUsageArchive(join(directory, 'usage-history.db'))
    try {
      const session = index.prepare(
        `INSERT INTO sessions_meta (session_id, cwd, started_at, message_count, source_mtime_ms, title)
         VALUES (?, ?, ?, 1, ?, ?)`
      )
      session.run('older', renamed, '2026-11-06T10:00:00.000Z', 1, 'First name')
      session.run('newer', renamed, '2026-11-06T12:00:00.000Z', 2, 'Renamed')
      session.run('newest', renamed, '2026-11-06T13:00:00.000Z', 3, null)
      session.run('repo', '/Users/sai/code/repo', '2026-11-01T00:00:00.000Z', 4, 'Repo work')
      const archived = archive.prepare('INSERT INTO history_sessions VALUES (?, ?, ?, NULL, 1, 0)')
      archived.run('gone', renamed, '2026-11-05T23:00:00.000Z')
      archived.run('pruned', pruned, '2026-10-07T09:00:00.000Z')

      expect(Object.fromEntries(readClaudeAppChats(index, archive))).toEqual({
        [renamed]: {
          title: 'Renamed',
          startedAt: '2026-11-05T23:00:00.000Z'
        },
        [pruned]: { title: null, startedAt: '2026-10-07T09:00:00.000Z' }
      })
    } finally {
      index.close()
      archive.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('marks chat projects at read time without touching the persisted locations', () => {
    const locations = reconcileUsageProjects([], [], [renamed, pruned, '/Users/sai/code/repo'])
    const saved = JSON.stringify(locations)

    const catalog = usageProjectCatalog(
      locations,
      new Map([[renamed, { title: 'Renamed', startedAt: '2026-11-06T10:00:00.000Z' }]])
    )

    expect(catalog.projects.find((project) => project.path === renamed)?.chat).toEqual({
      title: 'Renamed',
      startedAt: '2026-11-06T10:00:00.000Z'
    })
    expect(catalog.projects.find((project) => project.path === pruned)?.chat).toEqual({
      title: null,
      startedAt: null
    })
    expect(
      catalog.projects.find((project) => project.path === '/Users/sai/code/repo')
    ).not.toHaveProperty('chat')
    expect(JSON.stringify(catalog.locations)).toBe(saved)
  })
})
