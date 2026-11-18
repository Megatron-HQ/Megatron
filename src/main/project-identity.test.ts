import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { createProjectIdentity, type ProjectIdentityOwner } from './project-identity'
import { usageProjectCatalog } from './usage-projects'
import { grantPath, resetGrantedPaths } from './permissions'
import { groupProjectCounts } from '../shared/usage-projects'
import type { UsageProjectLocation } from '../shared/usage-projects'
import type { CanonicalCheckout, ProjectFolder, WorktreeLink } from '../shared/ipc'

const repository = (path: string): ProjectFolder => ({
  path,
  kind: 'repository',
  status: 'available'
})

interface HarnessState {
  saved: unknown
  writes: number
  failWrites: boolean
  projects: ProjectFolder[]
  paths: string[]
}

// An in-memory preferences.json: `saved` is what a restart would read back.
function harness(
  saved: unknown = [],
  claudeCodeFolders: string[] = []
): {
  owner: ProjectIdentityOwner
  state: HarnessState
  usagePath: (path: string) => string
  checkout: (path: string) => string | undefined
  roots: () => string[]
  find: (path: string) => UsageProjectLocation
  scan: (worktrees: WorktreeLink[], canonicalCheckouts?: CanonicalCheckout[]) => void
} {
  const state: HarnessState = {
    saved,
    writes: 0,
    failWrites: false,
    projects: [],
    paths: []
  }
  const owner = createProjectIdentity({
    store: {
      read: () => state.saved,
      write: (locations) => {
        if (state.failWrites) throw new Error('disk full')
        state.writes++
        state.saved = JSON.parse(JSON.stringify(locations))
      }
    },
    claudeCodeFolders,
    sessionPaths: () => state.paths,
    catalog: () => state.projects
  })
  const usagePath = (path: string): string => owner.identity().usageProjectOf(path)?.path ?? path
  const checkout = (path: string): string | undefined =>
    owner.identity().checkoutOf(path)?.canonical
  const roots = (): string[] =>
    owner
      .snapshot()
      .locations.filter((entry) => !entry.linkedTo)
      .map((entry) => entry.path)
      .sort()
  const find = (path: string): UsageProjectLocation =>
    owner.snapshot().locations.find((entry) => entry.path === path)!
  const scan = (worktrees: WorktreeLink[], canonicalCheckouts: CanonicalCheckout[] = []): void =>
    owner.recordScan({ worktrees, canonicalCheckouts })
  return { owner, state, usagePath, checkout, roots, find, scan }
}

describe('Usage Projects', () => {
  it('groups Windows path variants and subfolders under the nearest repository', () => {
    const { owner, state } = harness()
    state.projects = [repository('C:\\HQ\\Megatron'), repository('C:\\HQ\\Megatron\\Child')]
    state.paths = ['c:/hq/megatron/src/', 'C:\\HQ\\Megatron\\Child\\src']
    owner.reconcile()
    expect(owner.snapshot().locations).toHaveLength(2)
    expect(
      groupProjectCounts(
        [
          { project: 'c:/HQ/Megatron/', count: 3 },
          { project: 'C:\\HQ\\Megatron\\src', count: 5 },
          { project: 'C:\\HQ\\Megatron\\Child\\src', count: 2 }
        ],
        owner.identity()
      )
    ).toEqual([
      { project: 'C:\\HQ\\Megatron', count: 8 },
      { project: 'C:\\HQ\\Megatron\\Child', count: 2 }
    ])
  })

  it('keeps a location and its ID across a restart that loses access to it', () => {
    const first = harness()
    first.state.projects = [repository('C:\\HQ\\Megatron')]
    first.owner.reconcile()
    const id = first.owner.snapshot().locations[0].id

    const later = harness(first.state.saved)
    later.state.paths = ['C:\\HQ\\Megatron\\src']
    later.owner.reconcile()

    expect(later.owner.snapshot().locations).toEqual([
      { id, path: 'C:\\HQ\\Megatron', kind: 'repository', status: 'needs_access' }
    ])
    expect(later.usagePath('c:/hq/megatron/src')).toBe('C:\\HQ\\Megatron')
  })

  it('combines a confirmed move reversibly without giving parent-folder activity to a child', () => {
    const { owner, state, find } = harness()
    state.projects = [repository('C:\\HQ\\Megatron'), repository('C:\\HQ\\Megatron-site')]
    state.paths = ['C:\\Megatron', 'C:\\HQ']
    owner.reconcile()
    const old = find('C:\\Megatron')
    const current = find('C:\\HQ\\Megatron')
    expect(old.linkedTo).toBeUndefined()
    const counts = [
      { project: old.path, count: 29 },
      { project: current.path, count: 13 },
      { project: 'C:\\HQ', count: 4 }
    ]

    owner.link(old.id, current.id)
    expect(groupProjectCounts(counts, owner.identity())).toEqual([
      { project: current.path, count: 42 },
      { project: 'C:\\HQ', count: 4 }
    ])
    expect(find('C:\\Megatron').linkedTo).toBe(current.id)

    owner.unlink(old.id)
    expect(groupProjectCounts(counts, owner.identity())).toEqual(counts)
  })

  it('keeps clones separate and offers matching names as suggestions instead of merging', () => {
    const { owner, state, usagePath } = harness()
    state.projects = [repository('/work/repo'), repository('/copy/repo')]
    owner.reconcile()
    const catalog = usageProjectCatalog(owner.snapshot())
    expect(catalog.projects.map((project) => project.label)).toEqual(['copy/repo', 'work/repo'])
    expect(catalog.projects[0].possibleMatches).toEqual([catalog.projects[1].id])
    expect(usagePath('/work/repo')).toBe('/work/repo')
    expect(usagePath('/copy/repo')).toBe('/copy/repo')
  })

  it('gives earlier subfolders to a repository discovered later, without merging nested ones', () => {
    const { owner, state, usagePath, find } = harness()
    state.paths = ['/work/repo/src', '/work/repo/child/src']
    owner.reconcile()
    state.projects = [repository('/work/repo')]
    owner.reconcile()
    expect(usagePath('/work/repo/child/src')).toBe('/work/repo')

    state.projects = [repository('/work/repo'), repository('/work/repo/child')]
    owner.reconcile()
    expect(usagePath('/work/repo/src')).toBe('/work/repo')
    expect(usagePath('/work/repo/child/src')).toBe('/work/repo/child')
    expect(() => owner.unlink(find('/work/repo/src').id)).toThrow(
      'Working directories belong to their nearest repository.'
    )
  })

  it('uses a linked historical location as the root of folders seen under it later', () => {
    const { owner, state, usagePath, find } = harness()
    state.projects = [repository('/current/repo')]
    state.paths = ['/previous/repo']
    owner.reconcile()
    owner.link(find('/previous/repo').id, find('/current/repo').id)
    expect(usagePath('/previous/repo/src')).toBe('/current/repo')
    expect(usagePath('/previous/repository')).toBe('/previous/repository')
  })

  it('keeps POSIX case and directory boundaries', () => {
    const { owner, state, usagePath } = harness()
    state.projects = [repository('/work/Repo'), repository('/work/repo')]
    state.paths = ['/work/repository']
    owner.reconcile()
    expect(usagePath('/work/Repo/src')).toBe('/work/Repo')
    expect(usagePath('/work/repo/src')).toBe('/work/repo')
    expect(usagePath('/work/repository')).toBe('/work/repository')
  })

  it('rejects unknown identities and cyclic or self links', () => {
    const { owner, state, find } = harness()
    state.projects = [repository('/a'), repository('/b')]
    owner.reconcile()
    const [a, b] = [find('/a').id, find('/b').id]
    expect(() => owner.link('unknown', a)).toThrow(
      'Project location is no longer available. Refresh and try again.'
    )
    expect(() => owner.link(a, a)).toThrow('These locations already belong to the same project.')
    owner.link(a, b)
    expect(() => owner.link(b, a)).toThrow('These locations already belong to the same project.')
    expect(() => owner.unlink(b)).toThrow(
      'This is the primary location. Choose a linked location to separate.'
    )
    expect(() => owner.unlink('unknown')).toThrow(
      'Project location is no longer available. Refresh and try again.'
    )
  })

  it('recovers malformed saved metadata without adopting invalid links or duplicate paths', () => {
    const { owner } = harness([
      { id: 'one', path: 'C:\\Repo', kind: 'repository', status: 'available', linkedTo: 'missing' },
      { id: 'two', path: 'c:/repo/', kind: 'repository', status: 'available' },
      { id: 'bad', path: null },
      { id: 'relative', path: 'repo', kind: 'folder', status: 'available' }
    ])
    expect(owner.snapshot().locations).toEqual([
      { id: 'one', path: 'C:\\Repo', kind: 'repository', status: 'available' }
    ])
  })

  it('reports live availability on read: missing under a grant, needs access outside', () => {
    const directory = mkdtempSync(join(tmpdir(), 'usage-project-availability-'))
    try {
      grantPath(directory)
      writeFileSync(join(directory, 'one.txt'), 'one')
      const { owner, state } = harness()
      state.projects = [
        repository(directory),
        repository(join(directory, 'removed')),
        repository('C:\\private-ungranted-project')
      ]
      owner.reconcile()
      expect(owner.locations().map((entry) => entry.status)).toEqual([
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

describe('writes', () => {
  it('never writes on a read, and skips a reconcile that changes nothing', () => {
    const { owner, state } = harness()
    state.projects = [repository('/repo')]
    state.paths = ['/repo/src', '/elsewhere']
    owner.snapshot()
    expect(state.writes).toBe(0)

    owner.reconcile()
    expect(state.writes).toBe(1)
    owner.snapshot()
    owner.locations()
    owner.identity().usageProjectOf('/elsewhere/deeper')
    owner.identity().checkoutOf('/repo/.claude/worktrees/x')
    owner.reconcile()
    expect(state.writes).toBe(1)
  })

  it('changes nothing when the write fails', () => {
    const { owner, state, find, scan } = harness()
    state.projects = [repository('/a'), repository('/b')]
    owner.reconcile()
    const snapshot = owner.snapshot()
    const locations = owner.locations()
    const saved = state.saved
    state.failWrites = true

    expect(() => owner.link(find('/a').id, find('/b').id)).toThrow('disk full')
    expect(() => scan([{ path: '/wt/a-x', canonical: '/a' }])).toThrow('disk full')
    state.paths = ['/new']
    expect(() => owner.reconcile()).toThrow('disk full')

    expect(owner.snapshot()).toEqual(snapshot)
    expect(owner.locations()).toEqual(locations)
    expect(owner.identity().checkoutOf('/wt/a-x')).toBeNull()
    expect(state.saved).toBe(saved)
  })

  it('applies Scan evidence on top of a reconciled list', () => {
    // What an older version saved: a Worktree linked into Git metadata, which reconciliation clears
    // along with the empty target. Evidence applied first would keep that target alive.
    const ghost = '/code/app/.git/modules'
    const { roots, scan } = harness([
      { id: 'ghost', path: ghost, kind: 'repository', status: 'needs_access' },
      {
        id: 'legacy',
        path: '/wt/legacy',
        kind: 'repository',
        status: 'needs_access',
        linkedTo: 'ghost',
        worktree: true
      }
    ])
    scan([{ path: '/wt/other', canonical: '/wt/legacy' }], [{ path: '/wt/legacy' }])
    expect(roots()).toEqual(['/wt/legacy'])
  })

  it('reconciles again after the evidence, so folders under a new Worktree join its repo', () => {
    const { owner, state, roots, usagePath, scan } = harness()
    // What earlier versions saved: every Worktree folder its own project.
    state.paths = ['/wt/app-x', '/wt/app-x/src', '/code/app']
    owner.reconcile()
    expect(roots()).toEqual(['/code/app', '/wt/app-x', '/wt/app-x/src'])

    scan([{ path: '/wt/app-x', canonical: '/code/app' }])

    expect(roots()).toEqual(['/code/app'])
    expect(usagePath('/wt/app-x/src')).toBe('/code/app')
    expect(usagePath('/wt/app-x/new')).toBe('/code/app')
  })

  it('reconciles but changes no link when a Scan brings no findings', () => {
    const { owner, state, checkout, roots } = harness()
    owner.recordScan({
      worktrees: [{ path: '/wt/app-x', canonical: '/code/app' }],
      canonicalCheckouts: []
    })
    state.paths = ['/elsewhere']
    owner.recordScan(undefined)
    expect(checkout('/wt/app-x')).toBe('/code/app')
    expect(roots()).toEqual(['/code/app', '/elsewhere'])
  })
})

describe('Worktrees', () => {
  const repositoryIdentity = '1:2:3'
  const link = { path: '/wt/app-x', canonical: '/code/app' }

  it.each([false, true])(
    'promotes a former Worktree and keeps history and manual groups (manual=%s)',
    (manual) => {
      const { owner, state, find, checkout, usagePath, scan } = harness()
      state.projects = [repository('/external')]
      scan(
        [
          { path: '/a', canonical: '/main' },
          { path: '/z', canonical: '/main' }
        ],
        [{ path: '/main', repository: repositoryIdentity }]
      )
      const ids = owner
        .snapshot()
        .locations.map((entry) => entry.id)
        .sort()
      if (manual) owner.link(find('/main').id, find('/external').id)

      scan([{ path: '/z', canonical: '/a' }], [{ path: '/a', repository: repositoryIdentity }])
      state.projects = [repository('/a')]
      owner.reconcile()

      expect(
        owner
          .snapshot()
          .locations.map((entry) => entry.id)
          .sort()
      ).toEqual(ids)
      expect(find('/a').worktree).toBeUndefined()
      expect(checkout('/main')).toBe('/a')
      expect(checkout('/z')).toBe('/a')
      expect(checkout('/a')).toBeUndefined()
      for (const path of ['/main', '/a', '/z'])
        expect(usagePath(path)).toBe(manual ? '/external' : '/a')
      expect(
        groupProjectCounts(
          [
            { project: '/main', count: 3 },
            { project: '/a', count: 1 },
            { project: '/z', count: 1 }
          ],
          owner.identity()
        )
      ).toEqual([{ project: manual ? '/external' : '/a', count: 5 }])
    }
  )

  it('promotes a single survivor only with positive canonical evidence', () => {
    const { owner, state, find, checkout, scan } = harness()
    scan([{ path: '/a', canonical: '/main' }], [{ path: '/main', repository: repositoryIdentity }])
    state.projects = [repository('/a')]
    owner.reconcile()
    scan([])
    expect(checkout('/a')).toBe('/main')

    scan([], [{ path: '/a', repository: repositoryIdentity }])
    expect(checkout('/main')).toBe('/a')
    expect(checkout('/a')).toBeUndefined()
    expect(find('/a').worktree).toBeUndefined()
  })

  it('makes a canonical transition independent of link order and Windows spelling', () => {
    const first = harness()
    first.scan([
      { path: 'C:/repo/a', canonical: 'C:/repo/main' },
      { path: 'C:/repo/z', canonical: 'C:/repo/main' }
    ])
    const links = [
      { path: 'c:/REPO/main', canonical: 'c:/repo/A' },
      { path: 'C:/repo/z', canonical: 'c:/repo/A' }
    ]
    const forward = harness(first.state.saved)
    forward.scan(links, [{ path: 'c:/repo/A' }])
    const reverse = harness(first.state.saved)
    reverse.scan([...links].reverse(), [{ path: 'c:/repo/A' }])

    expect(reverse.owner.snapshot()).toEqual(forward.owner.snapshot())
    expect(forward.checkout('C:/repo/main')).toBe('C:/repo/a')
    expect(forward.checkout('C:/repo/z')).toBe('C:/repo/a')
  })

  it('adds an unknown Canonical Checkout as a repository that needs access', () => {
    const { find, scan } = harness()
    scan([link])
    expect(find('/code/app')).toMatchObject({ kind: 'repository', status: 'needs_access' })
    expect(find('/wt/app-x')).toMatchObject({ worktree: true })
  })

  it('keeps the link after the Worktree is gone', () => {
    const first = harness()
    first.scan([link])
    const later = harness(first.state.saved)
    later.state.paths = ['/wt/app-x']
    later.scan([])
    expect(later.roots()).toEqual(['/code/app'])
    expect(later.checkout('/wt/app-x')).toBe('/code/app')
  })

  it('moves the link when newer evidence names another repository', () => {
    const { usagePath, checkout, scan } = harness()
    scan([link])
    scan([{ path: '/wt/app-x', canonical: '/code/other' }])
    expect(usagePath('/wt/app-x')).toBe('/code/other')
    expect(checkout('/wt/app-x')).toBe('/code/other')
  })

  it('keeps a Worktree linked when only a link names it canonical', () => {
    const { find, roots, checkout, scan } = harness()
    scan([{ path: '/code/b', canonical: '/code/a' }])
    scan([{ path: '/code/c', canonical: '/code/b' }])
    expect(find('/code/b')).toMatchObject({ worktree: true })
    expect(roots()).toEqual(['/code/a'])
    expect(checkout('/code/c')).toBe('/code/a')
  })

  it('makes a former Worktree its own project when positive evidence names it canonical', () => {
    const { find, roots, usagePath, scan } = harness()
    scan([{ path: '/code/b', canonical: '/code/a' }])
    scan([{ path: '/code/c', canonical: '/code/b' }], [{ path: '/code/b' }])
    expect(find('/code/b').worktree).toBeUndefined()
    expect(find('/code/b').linkedTo).toBeUndefined()
    expect(roots()).toEqual(['/code/a', '/code/b'])
    expect(usagePath('/code/c')).toBe('/code/b')
    expect(usagePath('/code/a')).toBe('/code/a')
  })

  it("sends Claude Code's layout inside a Worktree to that Worktree's Canonical Checkout", () => {
    const first = harness()
    first.scan([{ path: '/code/b', canonical: '/code/a' }])
    const later = harness(first.state.saved)
    later.state.paths = ['/code/b/.claude/worktrees/x']
    later.owner.reconcile()
    expect(later.find('/code/b')).toMatchObject({ worktree: true })
    expect(later.roots()).toEqual(['/code/a'])
    expect(later.usagePath('/code/b/.claude/worktrees/x')).toBe('/code/a')
    expect(later.checkout('/code/b/.claude/worktrees/x')).toBe('/code/a')
  })

  it('turns the link around when evidence swaps the two checkouts', () => {
    const { find, usagePath, checkout, scan } = harness()
    scan([{ path: '/code/b', canonical: '/code/a' }])
    scan([{ path: '/code/a', canonical: '/code/b' }], [{ path: '/code/b' }])
    expect(find('/code/b').worktree).toBeUndefined()
    expect(checkout('/code/a')).toBe('/code/b')
    expect(checkout('/code/b')).toBeUndefined()
    expect(usagePath('/code/a')).toBe('/code/b')
  })

  it('routes a previously pruned Worktree through a new Canonical Checkout', () => {
    const { usagePath, checkout, scan } = harness()
    scan([
      { path: '/code/old', canonical: '/code/a' },
      { path: '/code/b', canonical: '/code/a' }
    ])
    scan([{ path: '/code/a', canonical: '/code/b' }])
    expect(usagePath('/code/old/src')).toBe('/code/b')
    expect(checkout('/code/old')).toBe('/code/b')
  })

  it('keeps a Worktree pointed at its checkout when that checkout is linked elsewhere', () => {
    const first = harness()
    first.state.projects = [repository('/code/app'), repository('/old/app')]
    first.scan([link])
    first.owner.link(first.find('/code/app').id, first.find('/old/app').id)
    const later = harness(first.state.saved)
    later.owner.reconcile()
    expect(later.usagePath('/wt/app-x')).toBe('/old/app')
    expect(later.checkout('/wt/app-x')).toBe('/code/app')
  })

  it('refuses to unlink a Worktree from its Canonical Checkout', () => {
    const { owner, find, scan } = harness()
    scan([link])
    expect(() => owner.unlink(find('/wt/app-x').id)).toThrow(
      'Worktrees belong to their repository.'
    )
  })

  it('breaks a manual link from the checkout into its own Worktree', () => {
    const { owner, state, find, usagePath, scan } = harness()
    state.projects = [repository('/code/app')]
    state.paths = ['/wt/app-x']
    owner.reconcile()
    owner.link(find('/code/app').id, find('/wt/app-x').id)
    scan([link])
    expect(usagePath('/code/app')).toBe('/code/app')
    expect(usagePath('/wt/app-x')).toBe('/code/app')
  })

  it("links Claude Code's own worktree layout without git evidence", () => {
    const { owner, state, roots, usagePath } = harness()
    state.paths = ['/code/app/.claude/worktrees/fix/src']
    owner.reconcile()
    expect(roots()).toEqual(['/code/app'])
    expect(usagePath('/code/app/.claude/worktrees/fix/src')).toBe('/code/app')
  })

  it('drops a link into Git metadata and removes its empty target', () => {
    const { owner, state, roots, checkout, scan } = harness()
    scan([{ path: '/wt/legacy', canonical: '/code/app/.git/modules' }])
    expect(checkout('/wt/legacy')).toBeUndefined()
    state.paths = ['/wt/legacy/src']
    owner.reconcile()
    expect(roots()).toEqual(['/wt/legacy'])
  })

  describe('a former target saved by an older version', () => {
    const ghost = '/code/app/.git/modules'
    const saved = [
      { id: 'ghost', path: ghost, kind: 'repository', status: 'needs_access' },
      {
        id: 'legacy',
        path: '/wt/legacy',
        kind: 'repository',
        status: 'needs_access',
        linkedTo: 'ghost',
        worktree: true
      }
    ]

    it('stays while it has sessions', () => {
      const { owner, state, roots } = harness(saved)
      state.paths = [ghost + '/scripts']
      owner.reconcile()
      expect(roots()).toEqual([ghost, '/wt/legacy'])
    })

    it('stays while another location links to it', () => {
      const retained = {
        id: 'retained',
        path: '/retained',
        kind: 'repository',
        status: 'needs_access',
        linkedTo: 'ghost'
      }
      const { owner, roots } = harness([...saved, retained])
      owner.reconcile()
      expect(roots()).toEqual([ghost, '/wt/legacy'])
    })
  })

  it('clears a legacy home-layout link but keeps one Git proved', () => {
    const path = '/home/user/.claude/worktrees/hook'
    const folders = ['/home/user/.claude']
    const legacy = harness()
    legacy.state.paths = [path]
    legacy.owner.reconcile()
    expect(legacy.roots()).toEqual(['/home/user'])

    const cleaned = harness(legacy.state.saved, folders)
    cleaned.state.paths = [path + '/src']
    cleaned.owner.reconcile()
    expect(cleaned.roots()).toEqual([path])

    const fresh = harness([], folders)
    fresh.state.paths = [path]
    fresh.owner.reconcile()
    expect(fresh.roots()).toEqual([path])

    const proven = harness([], folders)
    proven.state.paths = [path]
    proven.scan([{ path, canonical: '/home/user' }])
    expect(proven.checkout(path)).toBe('/home/user')
  })
})
