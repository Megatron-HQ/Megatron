import type { SkillRow, SourceType } from '../../../shared/ipc'
import { getFolderBasename, getPluginBareName } from './source-name'

export type SourceFilterKind = 'all' | SourceType

export type SourceFilter =
  | { kind: 'all' }
  | { kind: 'global' }
  | { kind: 'project'; projectRoot?: string }
  | { kind: 'plugin'; pluginName?: string }

export const FILTER_LABEL: Record<SourceFilterKind, string> = {
  all: 'All Skills',
  global: 'Global',
  project: 'Project',
  plugin: 'Plugin'
}

export function isFilterEqual(a: SourceFilter, b: SourceFilter): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'project' && b.kind === 'project') {
    return a.projectRoot === b.projectRoot
  }
  if (a.kind === 'plugin' && b.kind === 'plugin') {
    return a.pluginName === b.pluginName
  }
  return true
}

export function matchesFilter(skill: SkillRow, filter: SourceFilter): boolean {
  if (filter.kind === 'all') return true
  if (skill.source_type !== filter.kind) return false
  if (filter.kind === 'project' && filter.projectRoot) {
    const targetRoot = filter.projectRoot.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '')
    const skillRoot = skill.project_root
      ? skill.project_root.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '')
      : null
    const skillPath = skill.source_path.replace(/\\/g, '/').toLowerCase()
    return skillRoot === targetRoot || skillPath.startsWith(targetRoot)
  }
  if (filter.kind === 'plugin' && filter.pluginName) {
    return (
      skill.plugin_name === filter.pluginName ||
      getPluginBareName(skill.plugin_name).toLowerCase() ===
        getPluginBareName(filter.pluginName).toLowerCase()
    )
  }
  return true
}

export function getFilterHeaderTitle(filter: SourceFilter): string {
  switch (filter.kind) {
    case 'all':
      return 'All Skills'
    case 'global':
      return 'Global'
    case 'project':
      return filter.projectRoot ? `Project / ${getFolderBasename(filter.projectRoot)}` : 'Project'
    case 'plugin':
      return filter.pluginName ? `Plugin / ${getPluginBareName(filter.pluginName)}` : 'Plugin'
  }
}
