import { describe, expect, it } from 'vitest'
import {
  createProjectLabelResolver,
  projectDisplayLabels,
  type ProjectLabelResolver
} from './project-tree'
import { createUsageProjectLabelResolver } from './usage-project-label'
import type { UsageProjectCatalog } from '../../../shared/usage-projects'

function hierarchyResolver(paths: string[]): ProjectLabelResolver {
  return createProjectLabelResolver(projectDisplayLabels(paths))
}

describe('usage project labels', () => {
  it('does not attribute an unknown working directory to a registered filesystem root', () => {
    const root = {
      id: 'root',
      path: '/',
      kind: 'repository' as const,
      status: 'available' as const
    }
    const catalog: UsageProjectCatalog = {
      locations: [root],
      projects: [{ id: root.id, path: '/', label: '/', locations: [root], possibleMatches: [] }]
    }
    expect(createUsageProjectLabelResolver([], hierarchyResolver([]), catalog)('')).toBe(
      'Unknown project'
    )
  })
  it('uses the complete retained catalog for renamed locations and stable disambiguation', () => {
    const old = {
      id: 'old',
      path: '/archive/PreviousName',
      kind: 'repository' as const,
      status: 'missing' as const,
      linkedTo: 'current'
    }
    const current = {
      id: 'current',
      path: '/work/clients/Megatron',
      kind: 'repository' as const,
      status: 'available' as const
    }
    const catalog: UsageProjectCatalog = {
      locations: [old, current],
      projects: [
        {
          id: 'current',
          path: current.path,
          label: 'clients/Megatron',
          locations: [old, current],
          possibleMatches: []
        }
      ]
    }
    const resolve = createUsageProjectLabelResolver([], hierarchyResolver([]), catalog)
    expect(resolve('/archive/PreviousName/src')).toBe('clients/Megatron')
    expect(resolve('/work/clients/Megatron')).toBe('clients/Megatron')
  })
  it('uses names for both catalog projects and granted folders', () => {
    const paths = ['C:\\HQ', 'C:\\HQ\\Megatron', 'C:\\HQ\\Site']
    const grants = [{ path: paths[0], granted_at: '' }]
    const hierarchy = createProjectLabelResolver(projectDisplayLabels(paths.slice(1)), grants)
    const resolve = createUsageProjectLabelResolver(paths, hierarchy)

    expect(paths.map(resolve)).toEqual(['HQ', 'Megatron', 'Site'])
    expect(hierarchy(paths[0])).toBe('HQ')
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
