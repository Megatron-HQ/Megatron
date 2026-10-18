import { describe, expect, it } from 'vitest'
import { buildProjectTree, createProjectLabelResolver, projectDisplayLabels } from './project-tree'
import type { ProjectFolder } from '../../../shared/ipc'

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

describe('project label resolver', () => {
  const paths = [
    'C:\\Megatron HQ\\Megatron',
    'C:\\Megatron HQ\\Megatron\\references\\Child',
    'C:\\Megatron HQ\\Megatron-site'
  ]
  const folders = [{ path: 'C:\\Megatron HQ', granted_at: '' }]
  const resolveLabel = createProjectLabelResolver(projectDisplayLabels(paths, folders), folders)

  it('uses the same display casing and hierarchy for Windows path variants', () => {
    expect(resolveLabel('c:/megatron hq/megatron/')).toBe('Megatron HQ/Megatron')
  })

  it('resolves invocation working directories to their nearest repository', () => {
    expect(resolveLabel('C:\\Megatron HQ\\Megatron\\src\\renderer')).toBe('Megatron HQ/Megatron')
    expect(resolveLabel('c:/megatron hq/megatron/references/child/src')).toBe(
      'Megatron HQ/Megatron/references/Child'
    )
  })

  it('keeps path boundaries and different repositories separate', () => {
    expect(resolveLabel('C:\\Megatron HQ\\Megatron-site')).toBe('Megatron HQ/Megatron-site')
    expect(resolveLabel('C:\\Megatron HQ\\Megatron-other')).toBe('Megatron HQ/Megatron-other')
  })

  it('uses the granted hierarchy for historical projects outside the current catalog', () => {
    expect(resolveLabel('c:/megatron hq')).toBe('Megatron HQ')
    expect(resolveLabel('C:\\Megatron HQ\\Archived\\OldRepo')).toBe('Megatron HQ/Archived/OldRepo')
    expect(resolveLabel('')).toBe('Unknown project')
  })

  it('preserves disambiguation and POSIX case sensitivity across screens', () => {
    const labels = projectDisplayLabels(['/work/a/repo', '/home/a/repo', '/work/Repo'])
    const resolveProject = createProjectLabelResolver(labels)
    expect(resolveProject('/work/a/repo/src')).toBe('work/a/repo')
    expect(resolveProject('/home/a/repo/src')).toBe('home/a/repo')
    expect(resolveProject('/work/Repo/src')).toBe('work/Repo')
    expect(resolveProject('/work/repo/src')).toBe('repo/src')
  })
})
describe('project tree', () => {
  it('keeps discovered folder casing when the registry spells the same path differently', () => {
    expect([...projectDisplayLabels(['C:\\HQ\\Megatron', 'c:/hq/megatron']).values()]).toEqual([
      'HQ/Megatron'
    ])
  })
  it('uses relative paths for duplicate table labels and preserves unique display casing', () => {
    const labels = projectDisplayLabels([
      'C:\\HQ\\apps\\Megatron',
      'c:/HQ/clients/Megatron',
      'C:\\HQ\\Site'
    ])
    expect([...labels.values()]).toEqual(['apps/Megatron', 'clients/Megatron', 'HQ/Site'])
  })
  it('uses the granted hierarchy consistently even when only one repository is shown', () => {
    const paths = [
      'C:\\work\\MegatronHQ\\megatron',
      'C:\\work\\MegatronHQ\\megatron\\children\\site'
    ]
    const folders = [{ path: 'C:\\work\\MegatronHQ', granted_at: '' }]
    expect([...projectDisplayLabels(paths, folders).values()]).toEqual([
      'MegatronHQ/megatron',
      'MegatronHQ/megatron/children/site'
    ])
    expect([...projectDisplayLabels([paths[1]], folders).values()]).toEqual([
      'MegatronHQ/megatron/children/site'
    ])
  })

  it('nests repositories beneath their nearest ancestor and aggregates descendants once', () => {
    const paths = [
      '/HQ/repo',
      '/HQ/repo/references/child',
      '/HQ/repo/references/child/grandchild',
      '/HQ/repo/other'
    ]
    const tree = buildProjectTree(
      [{ path: '/HQ', granted_at: '' }],
      paths.map((path) => ({
        path,
        kind: 'repository',
        status: 'available'
      })),
      paths.map((path) => ({ path, count: 1 }))
    )
    const repo = tree[0].children[0]
    expect(repo.path).toBe(paths[0])
    expect([repo.directCount, repo.count]).toEqual([1, 4])
    expect(repo.children.map((child) => child.label)).toEqual(['other', 'references/child'])
    expect(repo.children[1].children[0].path).toBe(paths[2])
    expect(repo.children[1].count).toBe(2)
  })
  it('marks an aggregate unavailable when a child uses cached data', () => {
    const tree = buildProjectTree(
      grants,
      catalog.map((entry) =>
        entry.path.endsWith('second') ? { ...entry, status: 'missing' } : entry
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
      [{ path: '/gone', kind: 'repository', status: 'missing' }],
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
  it('disambiguates both same-named siblings and respects directory boundaries', () => {
    const tree = buildProjectTree(
      [{ path: '/HQ', granted_at: '' }],
      [
        { path: '/HQ/a/repo', kind: 'repository', status: 'available' },
        { path: '/HQ/b/repo', kind: 'repository', status: 'available' },
        { path: '/HQ-other/repo', kind: 'repository', status: 'available' }
      ],
      []
    )
    const parent = tree.find((node) => node.path === '/HQ')!
    expect(parent.children.map((node) => node.label)).toEqual(['a/repo', 'b/repo'])
    expect(tree).toHaveLength(2)
  })
})
