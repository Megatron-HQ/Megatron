import type { PluginRow, PluginScope } from '../../../shared/ipc'
import { getFolderBasename } from './source-name'

// The Plugins section's equivalent of SourceFilter. Scope names follow Claude Code's own
// vocabulary — `user`, not `global`, matching what `claude plugin list` prints and what the
// inventory's Scope column already shows.
export type PluginFilter =
  | { kind: 'all' }
  | { kind: 'user' }
  | { kind: 'project'; projectPath?: string }
  | { kind: 'local'; projectPath?: string }

export interface FilterProject {
  path: string
  name: string
  count: number
}

// installed_plugins.json and a granted folder can spell one root differently — separator, drive
// case, trailing slash — so every path comparison here goes through this first.
function normalizeProjectPath(path: string): string {
  return path.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '')
}

export function isPluginFilterEqual(a: PluginFilter, b: PluginFilter): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'project' && b.kind === 'project') return a.projectPath === b.projectPath
  if (a.kind === 'local' && b.kind === 'local') return a.projectPath === b.projectPath
  return true
}

// A plugin matches if *any* of its installs does. A plugin installed both for the user and for a
// project is genuinely present in both places, so it belongs under both groups — collapsing it
// into one is the exact behaviour project-scope support removed.
export function matchesPluginFilter(plugin: PluginRow, filter: PluginFilter): boolean {
  if (filter.kind === 'all') return true

  return plugin.installs.some((install) => {
    if (install.scope !== filter.kind) return false
    if (filter.kind === 'user') return true
    if (!filter.projectPath) return true
    if (install.project_path === null) return false
    return normalizeProjectPath(install.project_path) === normalizeProjectPath(filter.projectPath)
  })
}

// The sidebar's child rows for one scope: every project root holding an install of that scope,
// with how many distinct plugins it holds. An install with no project_path is skipped — there's
// no root to name it by, let alone to filter on.
export function listFilterProjects(plugins: PluginRow[], scope: PluginScope): FilterProject[] {
  const byRoot = new Map<string, FilterProject>()

  for (const plugin of plugins) {
    const roots = new Set<string>()
    for (const install of plugin.installs) {
      if (install.scope !== scope || install.project_path === null) continue
      roots.add(install.project_path)
    }

    for (const root of roots) {
      const key = normalizeProjectPath(root)
      const existing = byRoot.get(key)
      if (existing) {
        existing.count += 1
      } else {
        byRoot.set(key, { path: root, name: getFolderBasename(root), count: 1 })
      }
    }
  }

  return [...byRoot.values()].sort((a, b) => a.name.localeCompare(b.name))
}

const SCOPE_TITLE: Record<PluginScope, string> = {
  user: 'User',
  project: 'Project',
  local: 'Local'
}

export function getPluginFilterHeaderTitle(filter: PluginFilter): string {
  if (filter.kind === 'all') return 'All Plugins'
  if (filter.kind !== 'user' && filter.projectPath) {
    return `${SCOPE_TITLE[filter.kind]} / ${getFolderBasename(filter.projectPath)} Plugins`
  }
  return `${SCOPE_TITLE[filter.kind]} Plugins`
}

// Reclaimed whenever the sidebar already states the scope. The plugins table carries six columns
// at an 860px minimum window; dropping this one is what lets a 220px sidebar sit beside it.
export function shouldShowScopeColumn(filter: PluginFilter): boolean {
  return filter.kind === 'all'
}
