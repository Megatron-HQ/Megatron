import type {
  PluginDetailResult,
  PluginInstall,
  PluginRow,
  PluginScope,
  ProjectFolder,
  SkillRow
} from '../../../shared/ipc'
import { getFolderBasename } from './source-name'
import { isWithinProjectPath, normalizeProjectPath } from '../../../shared/project-path'
import { projectDisplayLabels } from './project-tree'

// The Plugins section's equivalent of SourceFilter. Scope names follow Claude Code's own
// vocabulary — `user`, not `global`, matching what `claude plugin list` prints and what the
// inventory's Scope column already shows.
export type PluginFilter =
  | { kind: 'all' }
  | { kind: 'user' }
  | { kind: 'projects'; projectPath?: string; exact?: boolean }
  | { kind: 'unknown' }
  | { kind: 'project'; projectPath?: string }
  | { kind: 'local'; projectPath?: string }

export interface FilterProject {
  path: string
  name: string
  count: number
}

// installed_plugins.json and a granted folder can spell one root differently — separator, drive
// case, trailing slash — so every path comparison here goes through this first.
export function isPluginFilterEqual(a: PluginFilter, b: PluginFilter): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'projects' && b.kind === 'projects')
    return a.projectPath === b.projectPath && !!a.exact === !!b.exact
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
    if (filter.kind === 'unknown') return install.scope !== 'user' && install.project_path === null
    if (filter.kind === 'projects') {
      if (install.scope === 'user') return false
      if (!filter.projectPath) return true
      if (install.project_path === null) return false
      return filter.exact
        ? normalizeProjectPath(install.project_path) === normalizeProjectPath(filter.projectPath)
        : isWithinProjectPath(install.project_path, filter.projectPath)
    }
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
  if (filter.kind === 'unknown') return 'Unknown Project Plugins'
  if (filter.kind === 'projects')
    return filter.projectPath
      ? `Projects / ${getFolderBasename(filter.projectPath)} Plugins`
      : 'Project Plugins'
  if (filter.kind !== 'user' && filter.projectPath) {
    return `${SCOPE_TITLE[filter.kind]} / ${getFolderBasename(filter.projectPath)} Plugins`
  }
  return `${SCOPE_TITLE[filter.kind]} Plugins`
}

// Reclaimed whenever the sidebar already states the scope. The plugins table carries six columns
// at an 860px minimum window; dropping this one is what lets a 220px sidebar sit beside it.
export function shouldShowScopeColumn(filter: PluginFilter): boolean {
  return filter.kind === 'all' || filter.kind === 'projects' || filter.kind === 'unknown'
}

export type PluginContext =
  { kind: 'all' } | { kind: 'user' } | { kind: 'project'; path: string } | { kind: 'unknown' }

export interface PluginRepositoryRow extends PluginRow {
  rowKey: string
  context: PluginContext
  repositoryLabel: string
  repositoryPath: string | null
}

function contextKey(context: PluginContext): string {
  return context.kind === 'project' ? normalizeProjectPath(context.path) : context.kind
}

function belongsToContext(install: PluginInstall, context: PluginContext): boolean {
  if (context.kind === 'all') return true
  if (context.kind === 'user') return install.scope === 'user'
  if (context.kind === 'unknown') return install.scope !== 'user' && install.project_path === null
  return (
    install.scope !== 'user' &&
    install.project_path !== null &&
    normalizeProjectPath(install.project_path) === normalizeProjectPath(context.path)
  )
}

function withInstalls(plugin: PluginRow, installs: PluginInstall[]): PluginRow {
  return {
    ...plugin,
    installs,
    installed_version: installs[0]?.installed_version ?? plugin.installed_version,
    available_version:
      installs.find((install) => install.available_version !== null)?.available_version ?? null,
    disabled_reason:
      installs.length > 0 && installs.every((install) => install.disabled_reason !== null)
        ? 'plugin'
        : null
  }
}

export function createPluginRows(
  plugins: PluginRow[],
  filter: PluginFilter = { kind: 'all' },
  projects: ProjectFolder[] = [],
  skillSources?: Pick<SkillRow, 'source_path' | 'plugin_name'>[]
): PluginRepositoryRow[] {
  const availability = new Map(
    projects.map((project) => [normalizeProjectPath(project.path), project.status])
  )
  const labels = projectDisplayLabels(
    plugins.flatMap((plugin) =>
      plugin.installs.flatMap((install) =>
        install.project_path === null ? [] : [install.project_path]
      )
    )
  )
  return plugins.flatMap((plugin) => {
    const groups = new Map<string, { context: PluginContext; installs: PluginInstall[] }>()
    for (const install of plugin.installs) {
      const context: PluginContext =
        install.scope === 'user'
          ? { kind: 'user' }
          : install.project_path === null
            ? { kind: 'unknown' }
            : { kind: 'project', path: install.project_path }
      const key = contextKey(context)
      const group = groups.get(key) ?? { context, installs: [] }
      const unavailable =
        context.kind === 'project' && availability.has(key) && availability.get(key) !== 'available'
      group.installs.push(unavailable ? { ...install, enablement_known: false } : install)
      groups.set(key, group)
    }
    return [...groups.values()]
      .map(({ context, installs }) => ({
        ...withInstalls(plugin, installs),
        ...(skillSources
          ? {
              skill_count: skillSources.filter(
                (skill) =>
                  skill.plugin_name === `${plugin.name}@${plugin.marketplace}` &&
                  installs.some((install) =>
                    isWithinProjectPath(skill.source_path, install.install_path)
                  )
              ).length
            }
          : {}),
        context,
        rowKey: JSON.stringify([
          plugin.name,
          plugin.marketplace,
          context.kind,
          contextKey(context)
        ]),
        repositoryPath: context.kind === 'project' ? context.path : null,
        repositoryLabel:
          context.kind === 'project'
            ? (labels.get(normalizeProjectPath(context.path)) ?? getFolderBasename(context.path))
            : context.kind === 'user'
              ? 'User'
              : 'Unknown project'
      }))
      .filter((row) => matchesPluginFilter(row, filter))
  })
}

export function scopePluginDetail(
  detail: PluginDetailResult,
  context: PluginContext,
  unavailable = false
): PluginDetailResult | null {
  const installs = detail.plugin.installs
    .filter((install) => belongsToContext(install, context))
    .map((install) => (unavailable ? { ...install, enablement_known: false } : install))
  if (installs.length === 0) return null
  const skills =
    context.kind === 'all'
      ? detail.skills
      : detail.skills.filter((skill) =>
          installs.some((install) => isWithinProjectPath(skill.source_path, install.install_path))
        )
  return {
    ...detail,
    plugin: { ...withInstalls(detail.plugin, installs), skill_count: skills.length },
    skills,
    errorCount: skills.reduce((sum, skill) => sum + skill.error_count, 0),
    warningCount: skills.reduce((sum, skill) => sum + skill.warning_count, 0)
  }
}
