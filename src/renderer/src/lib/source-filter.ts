import type { SkillRow } from '../../../shared/ipc'
import { getFolderBasename, getPluginBareName } from './source-name'

export type SourceFilter =
  | { kind: 'all' }
  | { kind: 'global' }
  | { kind: 'project'; projectRoot?: string }
  | { kind: 'plugin'; pluginName?: string }
  | { kind: 'disabled' }
  | { kind: 'user-invocable-only' }

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
  if (filter.kind === 'disabled') {
    // Mirrors getContextBudget()'s WHERE source_type IN ('global','plugin') in queries.ts — a
    // project skill can carry disabled_reason too (skillOverrides applies to project roots), but
    // it never counted toward the budget, so it can't appear in this filter's results either.
    return (
      skill.disabled_reason !== null &&
      (skill.source_type === 'global' || skill.source_type === 'plugin')
    )
  }
  if (filter.kind === 'user-invocable-only') {
    // disabled_reason === null is required, not defensive: getContextBudget() in
    // queries.ts makes the disabled and user-invocable-only audit buckets mutually exclusive
    // (a disabled skill that is also model_invocable = 0 counts only as disabled). Without it,
    // this filter's row count wouldn't match the userInvocableOnlyCount shown in the dialog.
    // The global/plugin restriction mirrors the budget query for the same reason.
    return (
      skill.model_invocable === 0 &&
      skill.disabled_reason === null &&
      (skill.source_type === 'global' || skill.source_type === 'plugin')
    )
  }
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
      return 'Global Skills'
    case 'project':
      return filter.projectRoot
        ? `Project / ${getFolderBasename(filter.projectRoot)} Skills`
        : 'Project Skills'
    case 'plugin':
      return filter.pluginName
        ? `Plugin / ${getPluginBareName(filter.pluginName)} Skills`
        : 'Plugin Skills'
    case 'disabled':
      return 'Disabled Skills'
    case 'user-invocable-only':
      return 'User-Invocable Only Skills'
  }
}

export function shouldShowSourceColumn(filter: SourceFilter): boolean {
  switch (filter.kind) {
    case 'all':
      return true
    case 'global':
      return false
    case 'project':
      return !filter.projectRoot
    case 'plugin':
      return !filter.pluginName
    case 'disabled':
      return true
    case 'user-invocable-only':
      return true
  }
}
