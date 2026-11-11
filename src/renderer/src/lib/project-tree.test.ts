import { describe, expect, it } from 'vitest'
import {
  buildProjectTree,
  createProjectLabelResolver,
  partitionFoldedChildren,
  projectDisplayLabels,
  snapProjectSelection,
  type ProjectTreeNode
} from './project-tree'
import type { AllowedPathRow, ProjectFolder } from '../../../shared/ipc'

const grants = [
  { path: 'C:\\HQ', granted_at: '' },
  { path: 'c:/HQ/first', granted_at: '' }
]
const catalog: ProjectFolder[] = [
  { path: 'C:\\HQ', kind: 'folder', status: 'available' },
  { path: 'C:\\HQ\\first', kind: 'repository', status: 'available' },
  { path: 'C:\\HQ\\second', kind: 'repository', status: 'available' },
  { path: 'C:\\HQ\\empty', kind: 'repository', status: 'available' }
]
const home = '/Users/me'
const grant = (path: string): AllowedPathRow => ({ path, granted_at: '' })
const repo = (path: string, status: ProjectFolder['status'] = 'available'): ProjectFolder => ({
  path,
  kind: 'repository',
  status
})
const labels = (nodes: ProjectTreeNode[]): string[] => nodes.map((node) => node.label)

describe('project label resolver', () => {
  const paths = [
    'C:\\Megatron HQ\\Megatron',
    'C:\\Megatron HQ\\Megatron\\references\\Child',
    'C:\\Megatron HQ\\Megatron-site'
  ]
  const folders = [{ path: 'C:\\Megatron HQ', granted_at: '' }]
  const resolveLabel = createProjectLabelResolver(projectDisplayLabels(paths), folders)

  it('uses the same display casing for Windows path variants', () => {
    expect(resolveLabel('c:/megatron hq/megatron/')).toBe('Megatron')
  })

  it('resolves invocation working directories to their nearest repository', () => {
    expect(resolveLabel('C:\\Megatron HQ\\Megatron\\src\\renderer')).toBe('Megatron')
    expect(resolveLabel('c:/megatron hq/megatron/references/child/src')).toBe('Child')
  })

  it('keeps path boundaries and different repositories separate', () => {
    expect(resolveLabel('C:\\Megatron HQ\\Megatron-site')).toBe('Megatron-site')
    expect(resolveLabel('C:\\Megatron HQ\\Megatron-other')).toBe('Megatron-other')
  })

  it('names granted folders and historical projects outside the current catalog', () => {
    expect(resolveLabel('c:/megatron hq')).toBe('Megatron HQ')
    expect(resolveLabel('C:\\Megatron HQ\\Archived\\OldRepo')).toBe('OldRepo')
    expect(resolveLabel('')).toBe('Unknown project')
  })

  it('preserves disambiguation and POSIX case sensitivity across screens', () => {
    const resolveProject = createProjectLabelResolver(
      projectDisplayLabels(['/work/a/repo', '/home/a/repo', '/work/Repo'])
    )
    expect(resolveProject('/work/a/repo/src')).toBe('work/a/repo')
    expect(resolveProject('/home/a/repo/src')).toBe('home/a/repo')
    expect(resolveProject('/work/Repo/src')).toBe('work/Repo')
    expect(resolveProject('/work/repo/src')).toBe('src')
  })
})

describe('project display labels', () => {
  it('keeps discovered folder casing when the registry spells the same path differently', () => {
    expect([...projectDisplayLabels(['C:\\HQ\\Megatron', 'c:/hq/megatron']).values()]).toEqual([
      'Megatron'
    ])
  })

  it('adds parent folders only to names that clash, ignoring case', () => {
    const result = projectDisplayLabels([
      'C:\\HQ\\apps\\Megatron',
      'c:/HQ/clients/megatron',
      'C:\\HQ\\Site'
    ])
    expect([...result.values()]).toEqual(['apps/Megatron', 'clients/megatron', 'Site'])
  })

  it('names a project the same way whether or not its parent folder is granted', () => {
    expect([
      ...projectDisplayLabels([
        'C:\\work\\MegatronHQ\\megatron',
        'C:\\work\\MegatronHQ\\megatron\\children\\site'
      ]).values()
    ]).toEqual(['megatron', 'site'])
  })

  it('falls back to the absolute path when every parent folder also clashes', () => {
    expect([...projectDisplayLabels(['/work/Repo', '/work/repo']).values()]).toEqual([
      '/work/Repo',
      '/work/repo'
    ])
  })
})

describe('project tree', () => {
  it('does not label a newly granted folder as failed before discovery finishes', () => {
    const tree = buildProjectTree([grants[0]], [], [])

    expect(tree).toHaveLength(1)
    expect(tree[0].path).toBe('C:\\HQ')
    expect(tree[0].status).toBeUndefined()
    expect(tree[0].count).toBe(0)
  })

  it('keeps cached counts quiet for covered projects awaiting discovery', () => {
    const tree = buildProjectTree([grants[0]], [], [{ path: 'C:\\HQ\\first', count: 3 }])

    expect(tree[0].count).toBe(3)
    expect(tree[0].children[0].count).toBe(3)
    expect(tree[0].children[0].status).toBeUndefined()
  })

  it.each(['available', 'unavailable', 'missing', 'needs_access'] as const)(
    'preserves a confirmed %s result while a later scan is pending',
    (status) => {
      const tree = buildProjectTree([grants[0]], [{ ...catalog[0], status }], [])

      expect(tree[0].status).toBe(status)
    }
  )

  it('keeps an unavailable child warning scoped to that child', () => {
    const tree = buildProjectTree(
      [grants[0]],
      [catalog[0], { ...catalog[1], status: 'unavailable' }],
      []
    )
    expect(tree[0].status).toBe('available')
    expect(tree[0].children[0].status).toBe('unavailable')
  })

  it('nests repositories beneath their nearest ancestor and aggregates descendants once', () => {
    const paths = [
      '/HQ/repo',
      '/HQ/repo/references/child',
      '/HQ/repo/references/child/grandchild',
      '/HQ/repo/other'
    ]
    const tree = buildProjectTree(
      [grant('/HQ')],
      paths.map((path) => repo(path)),
      paths.map((path) => ({ path, count: 1 }))
    )
    const parent = tree[0].children[0]
    expect(parent.path).toBe(paths[0])
    expect([parent.directCount, parent.count]).toEqual([1, 4])
    expect(labels(parent.children)).toEqual(['other', 'references/child'])
    expect(parent.children[1].chain).toEqual(['/HQ/repo/references'])
    expect(parent.children[1].children[0].path).toBe(paths[2])
    expect(parent.children[1].count).toBe(2)
  })

  it('retains a parent folder’s own unavailable status independently of its children', () => {
    const tree = buildProjectTree(
      grants,
      catalog.map((entry) =>
        entry.path === 'C:\\HQ' ? { ...entry, status: 'unavailable' } : entry
      ),
      []
    )
    expect(tree[0].status).toBe('unavailable')
  })

  it('sums repository counts without double-counting overlapping grants', () => {
    const tree = buildProjectTree(grants, catalog, [
      { path: 'C:\\HQ\\first', count: 3 },
      { path: 'C:\\HQ\\second', count: 3 }
    ])
    expect(tree).toHaveLength(1)
    expect(tree[0].count).toBe(6)
    expect(tree[0].children.map((node) => [node.label, node.count])).toEqual([
      ['empty', 0],
      ['first', 3],
      ['second', 3]
    ])
  })

  it('includes the parent own items in its aggregate', () => {
    const tree = buildProjectTree(grants, catalog, [
      { path: 'C:\\HQ', count: 2 },
      { path: 'C:\\HQ\\first', count: 3 }
    ])
    expect([tree[0].directCount, tree[0].count]).toEqual([2, 5])
  })

  it('preserves unavailable cached totals and marks unapproved referenced projects', () => {
    const tree = buildProjectTree(
      [],
      [repo('/gone', 'missing')],
      [
        { path: '/gone', count: 4 },
        { path: '/unapproved', count: 1 }
      ]
    )
    expect(tree.map((node) => [node.path, node.count, node.status])).toEqual([
      ['/gone', 4, 'missing'],
      ['/unapproved', 1, 'needs_access']
    ])
  })

  it('merges a lone intermediate folder into the row of the project inside it', () => {
    const tree = buildProjectTree(
      [grant('/HQ')],
      [repo('/HQ/a/repo'), repo('/HQ/b/repo'), repo('/HQ-other/repo')],
      []
    )
    const parent = tree.find((node) => node.path === '/HQ')!
    expect(labels(parent.children)).toEqual(['a/repo', 'b/repo'])
    expect(tree).toHaveLength(2)
  })

  it('groups grants that share a parent folder under one expanded row', () => {
    const tree = buildProjectTree(
      ['a', 'b', 'c'].map((name) => grant(`${home}/Desktop/${name}`)),
      [],
      [
        { path: `${home}/Desktop/a`, count: 2 },
        { path: `${home}/Desktop/c`, count: 1 }
      ],
      { home }
    )
    expect(tree).toHaveLength(1)
    expect(tree[0]).toMatchObject({
      key: `${home}/Desktop`,
      path: `${home}/Desktop`,
      label: 'Desktop',
      kind: 'group',
      status: undefined,
      directCount: 0,
      count: 3,
      defaultExpanded: true,
      pinned: true
    })
    expect(labels(tree[0].children)).toEqual(['a', 'b', 'c'])
    expect(tree[0].children[0].defaultExpanded).toBe(false)
  })

  it('shows a lone root by name and remembers the folders hidden above it', () => {
    const tree = buildProjectTree([grant(`${home}/Desktop/Megatron`)], [], [], { home })
    expect(tree[0].label).toBe('Megatron')
    expect(tree[0].chain).toEqual([`${home}/Desktop`])
  })

  it('reveals parent folders on roots whose names clash, ignoring case', () => {
    const tree = buildProjectTree(
      [grant(`${home}/Desktop/api`), grant(`${home}/work/API`)],
      [],
      [],
      { home }
    )
    expect(labels(tree)).toEqual(['Desktop/api', 'work/API'])
  })

  it('compacts a Go workspace chain into one group per shared folder', () => {
    const base = `${home}/go/src/github.com`
    const tree = buildProjectTree(
      [grant(`${base}/me/x`), grant(`${base}/me/y`), grant(`${base}/other/z`)],
      [],
      [],
      { home }
    )
    expect(tree).toHaveLength(1)
    expect(tree[0]).toMatchObject({ label: 'github.com', path: base, kind: 'group' })
    expect(tree[0].chain).toEqual([`${home}/go`, `${home}/go/src`])
    expect(labels(tree[0].children)).toEqual(['me', 'other/z'])
    expect(tree[0].children[0]).toMatchObject({ kind: 'group', defaultExpanded: true })
    expect(labels(tree[0].children[0].children)).toEqual(['x', 'y'])
  })

  it('groups Windows repositories under home with native separators and folded case keys', () => {
    const tree = buildProjectTree(
      [grant('C:\\Users\\Me\\source\\repos\\a'), grant('C:\\Users\\Me\\source\\repos\\b')],
      [],
      [],
      { home: 'C:\\Users\\Me' }
    )
    expect(tree).toHaveLength(1)
    expect(tree[0]).toMatchObject({
      label: 'repos',
      path: 'C:\\Users\\Me\\source\\repos',
      key: 'c:/users/me/source/repos',
      chain: ['c:/users/me/source']
    })
  })

  it('roots network shares and external volumes at the share or filesystem root', () => {
    const tree = buildProjectTree(
      [
        grant('\\\\server\\share\\team\\a'),
        grant('\\\\server\\share\\team\\b'),
        grant('/Volumes/External/a'),
        grant('/Volumes/External/b')
      ],
      [],
      [],
      { home }
    )
    expect(tree.map((node) => [node.label, node.path])).toEqual([
      ['External', '/Volumes/External'],
      ['team', '\\\\server\\share\\team']
    ])
  })

  it('shows the full relative folder chain inside a granted home folder', () => {
    const tree = buildProjectTree(
      [grant(home)],
      [repo(`${home}/Desktop/a`), repo(`${home}/Desktop/b`), repo(`${home}/code/c`)],
      [],
      { home }
    )
    expect(tree[0]).toMatchObject({ label: 'me', kind: 'folder' })
    expect(labels(tree[0].children)).toEqual(['code/c', 'Desktop'])
    expect(tree[0].children[1]).toMatchObject({ kind: 'group', defaultExpanded: false })
  })

  it('sorts siblings in natural order, ignoring case', () => {
    const tree = buildProjectTree(
      [grant('/HQ')],
      [repo('/HQ/repo10'), repo('/HQ/repo2'), repo('/HQ/Repo1')],
      []
    )
    expect(labels(tree[0].children)).toEqual(['Repo1', 'repo2', 'repo10'])
  })

  it('pins grants, warnings, and their ancestors but not quiet empty repositories', () => {
    const tree = buildProjectTree(
      [grant('/HQ')],
      [repo('/HQ/empty'), repo('/HQ/gone', 'missing'), repo('/HQ/gone/inner')],
      []
    )
    const byLabel = new Map(tree[0].children.map((node) => [node.label, node]))
    expect(tree[0].pinned).toBe(true)
    expect(byLabel.get('empty')!.pinned).toBe(false)
    expect(byLabel.get('gone')!.pinned).toBe(true)
    expect(byLabel.get('gone')!.children[0].pinned).toBe(false)
  })
})

describe('folded empty projects', () => {
  const tree = buildProjectTree(
    [grant('/HQ')],
    [repo('/HQ/empty'), repo('/HQ/quiet'), repo('/HQ/gone', 'missing'), repo('/HQ/used')],
    [{ path: '/HQ/used', count: 1 }]
  )
  const children = tree[0].children

  it('folds unpinned projects without items', () => {
    const { visible, folded } = partitionFoldedChildren(children)
    expect(labels(visible)).toEqual(['gone', 'used'])
    expect(labels(folded)).toEqual(['empty', 'quiet'])
  })

  it('keeps an empty project visible while the selection is inside it', () => {
    const { folded } = partitionFoldedChildren(children, '/HQ/quiet/src')
    expect(labels(folded)).toEqual(['empty'])
  })
})

describe('selection snapping', () => {
  const tree = buildProjectTree(
    [grant(`${home}/Desktop/a`), grant(`${home}/work/b`)],
    [repo(`${home}/Desktop/a/inner`), repo(`${home}/work/b/one`), repo(`${home}/work/b/two`)],
    [],
    { home }
  )

  it('keeps a selection that names a row or a folder merged into one', () => {
    const exact = { path: `${home}/Desktop/a/inner`, exact: true }
    expect(snapProjectSelection(tree, exact)).toBe(exact)
    const merged = { path: `${home}/Desktop` }
    expect(snapProjectSelection(tree, merged)).toBe(merged)
  })

  it('moves a vanished selection to the deepest row containing it', () => {
    expect(snapProjectSelection(tree, { path: `${home}/work/b/three/src` })).toEqual({
      path: `${home}/work/b`,
      exact: false
    })
    expect(snapProjectSelection(tree, { path: `${home}/Desktop/a/inner/deleted` })).toEqual({
      path: `${home}/Desktop/a/inner`,
      exact: true
    })
  })

  it('moves a selection above every row to the only row inside it', () => {
    const single = buildProjectTree([grant(`${home}/code/x/repo`)], [], [], { home })
    expect(snapProjectSelection(single, { path: home })).toEqual({
      path: `${home}/code/x/repo`,
      exact: false
    })
  })

  it('clears a selection with no related row', () => {
    expect(snapProjectSelection(tree, { path: home })).toEqual({
      path: undefined,
      exact: undefined
    })
    expect(snapProjectSelection(tree, { path: '/elsewhere' })).toEqual({
      path: undefined,
      exact: undefined
    })
  })
})
