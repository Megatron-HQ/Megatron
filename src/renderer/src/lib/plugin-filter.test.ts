import { describe, expect, it } from 'vitest'
import type { PluginInstall, PluginRow, PluginScope } from '../../../shared/ipc'
import {
  getPluginFilterHeaderTitle,
  isPluginFilterEqual,
  listFilterProjects,
  matchesPluginFilter,
  shouldShowScopeColumn
} from './plugin-filter'

function install(scope: PluginScope, projectPath: string | null = null): PluginInstall {
  return {
    scope,
    install_path: `/cache/plugin/${scope}`,
    installed_at: null,
    last_updated: null,
    git_commit_sha: null,
    project_path: projectPath,
    installed_version: '1.0.0',
    available_version: null,
    disabled_reason: null,
    enablement_known: true
  }
}

function plugin(name: string, installs: PluginInstall[]): PluginRow {
  return {
    name,
    marketplace: 'market-1',
    marketplace_repo: null,
    installed_version: '1.0.0',
    available_version: null,
    disabled_reason: null,
    skill_count: 0,
    installs
  }
}

describe('matchesPluginFilter', () => {
  it('matches every plugin under the all filter', () => {
    expect(matchesPluginFilter(plugin('a', [install('project', '/repo')]), { kind: 'all' })).toBe(
      true
    )
  })

  it('matches a user install under the user filter', () => {
    expect(matchesPluginFilter(plugin('a', [install('user')]), { kind: 'user' })).toBe(true)
  })

  it('rejects a project-only plugin under the user filter', () => {
    expect(matchesPluginFilter(plugin('a', [install('project', '/repo')]), { kind: 'user' })).toBe(
      false
    )
  })

  it('keeps local and project scopes distinct', () => {
    const localOnly = plugin('a', [install('local', '/repo')])
    expect(matchesPluginFilter(localOnly, { kind: 'local' })).toBe(true)
    expect(matchesPluginFilter(localOnly, { kind: 'project' })).toBe(false)
  })

  // The whole point of storing installs separately — a plugin installed both ways is genuinely
  // present in both places, so hiding it from either group would be the collapse we just removed.
  it('matches a plugin under both groups when it has a user and a project install', () => {
    const both = plugin('a', [install('user'), install('project', '/repo')])
    expect(matchesPluginFilter(both, { kind: 'user' })).toBe(true)
    expect(matchesPluginFilter(both, { kind: 'project' })).toBe(true)
  })

  it('narrows to one project when the filter names a project path', () => {
    const inRepoA = plugin('a', [install('project', '/repo-a')])
    expect(matchesPluginFilter(inRepoA, { kind: 'project', projectPath: '/repo-a' })).toBe(true)
    expect(matchesPluginFilter(inRepoA, { kind: 'project', projectPath: '/repo-b' })).toBe(false)
  })

  // Path comparison has to survive the same Windows separator/case mismatch matchesFilter
  // handles for skills — installed_plugins.json and a granted folder can disagree on both.
  it('matches a project path that differs only by separator, case, or trailing slash', () => {
    const row = plugin('a', [install('project', 'C:\\Repos\\Megatron')])
    expect(matchesPluginFilter(row, { kind: 'project', projectPath: 'c:/repos/megatron/' })).toBe(
      true
    )
  })

  it('does not match a project-scoped filter against a same-project local install', () => {
    const row = plugin('a', [install('local', '/repo')])
    expect(matchesPluginFilter(row, { kind: 'project', projectPath: '/repo' })).toBe(false)
  })

  it('rejects a plugin with no installs at all under a scope filter', () => {
    expect(matchesPluginFilter(plugin('a', []), { kind: 'user' })).toBe(false)
  })
})

describe('listFilterProjects', () => {
  it('returns one entry per project root holding an install of that scope', () => {
    const plugins = [
      plugin('a', [install('project', '/repo-a')]),
      plugin('b', [install('project', '/repo-b')])
    ]

    expect(listFilterProjects(plugins, 'project').map((entry) => entry.path)).toEqual([
      '/repo-a',
      '/repo-b'
    ])
  })

  it('counts every plugin installed into the same project root once', () => {
    const plugins = [
      plugin('a', [install('project', '/repo')]),
      plugin('b', [install('project', '/repo')])
    ]

    expect(listFilterProjects(plugins, 'project')).toEqual([
      { path: '/repo', name: 'repo', count: 2 }
    ])
  })

  it('separates project and local installs of the same project root', () => {
    const plugins = [plugin('a', [install('project', '/repo'), install('local', '/repo')])]

    expect(listFilterProjects(plugins, 'project')).toEqual([
      { path: '/repo', name: 'repo', count: 1 }
    ])
    expect(listFilterProjects(plugins, 'local')).toEqual([
      { path: '/repo', name: 'repo', count: 1 }
    ])
  })

  it('omits a project/local install that carries no project path', () => {
    expect(listFilterProjects([plugin('a', [install('project', null)])], 'project')).toEqual([])
  })

  it('sorts projects by display name', () => {
    const plugins = [
      plugin('a', [install('project', '/zebra')]),
      plugin('b', [install('project', '/alpha')])
    ]

    expect(listFilterProjects(plugins, 'project').map((entry) => entry.name)).toEqual([
      'alpha',
      'zebra'
    ])
  })

  // Two spellings of one root would otherwise render as two identical-looking sidebar rows,
  // each filtering to half the plugins.
  it('folds project roots that differ only by separator or case into one entry', () => {
    const plugins = [
      plugin('a', [install('project', 'C:\\Repos\\Megatron')]),
      plugin('b', [install('project', 'c:/repos/megatron')])
    ]

    expect(listFilterProjects(plugins, 'project')).toHaveLength(1)
    expect(listFilterProjects(plugins, 'project')[0].count).toBe(2)
  })
})

describe('getPluginFilterHeaderTitle', () => {
  it('names the all filter', () => {
    expect(getPluginFilterHeaderTitle({ kind: 'all' })).toBe('All Plugins')
  })

  it('names each scope', () => {
    expect(getPluginFilterHeaderTitle({ kind: 'user' })).toBe('User Plugins')
    expect(getPluginFilterHeaderTitle({ kind: 'project' })).toBe('Project Plugins')
    expect(getPluginFilterHeaderTitle({ kind: 'local' })).toBe('Local Plugins')
  })

  it('names the selected project', () => {
    expect(
      getPluginFilterHeaderTitle({ kind: 'project', projectPath: 'C:\\Repos\\Megatron' })
    ).toBe('Project / Megatron Plugins')
  })
})

describe('shouldShowScopeColumn', () => {
  it('shows the scope column when no scope is selected', () => {
    expect(shouldShowScopeColumn({ kind: 'all' })).toBe(true)
  })

  // The sidebar already states the scope, and the plugins table is six columns wide at an 860px
  // minimum — reclaiming this one is what keeps it from overflowing with a sidebar beside it.
  it('hides the scope column once a single scope is selected', () => {
    expect(shouldShowScopeColumn({ kind: 'user' })).toBe(false)
    expect(shouldShowScopeColumn({ kind: 'project' })).toBe(false)
    expect(shouldShowScopeColumn({ kind: 'local' })).toBe(false)
  })
})

describe('isPluginFilterEqual', () => {
  it('separates two different scopes', () => {
    expect(isPluginFilterEqual({ kind: 'user' }, { kind: 'local' })).toBe(false)
  })

  it('separates a scope group from one of its projects', () => {
    expect(
      isPluginFilterEqual({ kind: 'project' }, { kind: 'project', projectPath: '/repo' })
    ).toBe(false)
  })

  it('matches two references to the same project', () => {
    expect(
      isPluginFilterEqual(
        { kind: 'project', projectPath: '/repo' },
        { kind: 'project', projectPath: '/repo' }
      )
    ).toBe(true)
  })
})
