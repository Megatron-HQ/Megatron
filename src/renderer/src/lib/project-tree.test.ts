import { describe, expect, it } from 'vitest'
import { buildProjectTree, projectDisplayLabels } from './project-tree'
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
describe('project tree', () => {
  it('uses relative paths for duplicate table labels and preserves unique display casing', () => {
    const labels = projectDisplayLabels([
      'C:\\HQ\\apps\\Megatron',
      'c:/HQ/clients/Megatron',
      'C:\\HQ\\Site'
    ])
    expect([...labels.values()]).toEqual(['apps/Megatron', 'clients/Megatron', 'Site'])
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
