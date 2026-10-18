import { describe, expect, it } from 'vitest'
import {
  createProjectLabelResolver,
  projectDisplayLabels,
  type ProjectLabelResolver
} from './project-tree'
import { createUsageProjectLabelResolver } from './usage-project-label'

function hierarchyResolver(paths: string[]): ProjectLabelResolver {
  return createProjectLabelResolver(projectDisplayLabels(paths))
}

describe('usage project labels', () => {
  it('uses names for both catalog projects and granted folders without changing shared labels', () => {
    const paths = ['C:\\HQ', 'C:\\HQ\\Megatron', 'C:\\HQ\\Site']
    const grants = [{ path: paths[0], granted_at: '' }]
    const hierarchy = createProjectLabelResolver(
      projectDisplayLabels(paths.slice(1), grants),
      grants
    )
    const resolve = createUsageProjectLabelResolver(paths, hierarchy)

    expect(paths.map(resolve)).toEqual(['HQ', 'Megatron', 'Site'])
    expect(hierarchy(paths[1])).toBe('HQ/Megatron')
    expect(resolve('')).toBe('Unknown project')
  })

  it('adds only enough parent folders to distinguish duplicate project names', () => {
    const paths = ['/work/apps/repo', '/work/clients/repo', '/work/Site']
    const resolve = createUsageProjectLabelResolver(paths, hierarchyResolver(paths))

    expect(paths.map(resolve)).toEqual(['apps/repo', 'clients/repo', 'Site'])
  })

  it('distinguishes historical projects even when the shared fallback labels collide', () => {
    const paths = ['/work/a/repo', '/home/a/repo']
    const resolve = createUsageProjectLabelResolver(paths, hierarchyResolver([]))

    expect(paths.map(resolve)).toEqual(['work/a/repo', 'home/a/repo'])
  })

  it('preserves nearest-repository naming for subdirectories and nested repositories', () => {
    const roots = ['C:\\HQ\\Megatron', 'C:\\HQ\\Megatron\\references\\Child']
    const paths = [...roots, `${roots[0]}\\src\\renderer`, `${roots[1]}\\src`]
    const resolve = createUsageProjectLabelResolver(paths, hierarchyResolver(roots))

    expect(paths.map(resolve)).toEqual(['Megatron', 'Child', 'Megatron', 'Child'])
  })

  it('deduplicates Windows casing and separator variants while preserving catalog name casing', () => {
    const root = 'C:\\HQ\\Megatron'
    const paths = [root, 'c:/hq/megatron/', 'C:\\HQ\\Megatron\\src']
    const resolve = createUsageProjectLabelResolver(paths, hierarchyResolver([root]))

    expect(paths.map(resolve)).toEqual(['Megatron', 'Megatron', 'Megatron'])
  })

  it('keeps identical names in distinct POSIX paths separate', () => {
    const paths = ['/work/Repo', '/work/repo']
    const resolve = createUsageProjectLabelResolver(paths, hierarchyResolver(paths))

    expect(paths.map(resolve)).toEqual(['work/Repo', 'work/repo'])
  })

  it('uses one mapping for a narrow window or dialog subset', () => {
    const paths = ['/work/apps/repo', '/work/clients/repo', '/work/Site']
    const resolve = createUsageProjectLabelResolver(paths, hierarchyResolver(paths))

    expect([paths[0]].map(resolve)).toEqual(['apps/repo'])
    expect([paths[1], paths[2]].map(resolve)).toEqual(['clients/repo', 'Site'])
  })

  it('handles filesystem roots and missing data', () => {
    const paths = ['/', 'C:\\']
    const resolve = createUsageProjectLabelResolver(paths, hierarchyResolver(paths))

    expect(paths.map(resolve)).toEqual(['/', 'C:'])
    expect(createUsageProjectLabelResolver([], hierarchyResolver([]))('')).toBe('Unknown project')
  })
})
