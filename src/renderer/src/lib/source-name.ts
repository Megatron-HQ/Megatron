import type { SourceType } from '../../../shared/ipc'

export function getFolderBasename(fullPath?: string | null): string {
  if (!fullPath) return ''
  const normalized = fullPath.replace(/[\\/]+$/, '')
  const parts = normalized.split(/[\\/]/)
  return parts[parts.length - 1] || fullPath
}

export function getPluginBareName(pluginName: string | null | undefined): string {
  if (!pluginName || pluginName.trim() === '') return 'plugin'
  const atIndex = pluginName.lastIndexOf('@')
  if (atIndex <= 0) return pluginName
  return pluginName.slice(0, atIndex)
}

export function getProjectNameFromPath(sourcePath?: string): string {
  if (!sourcePath) return 'project'
  const normalized = sourcePath.replace(/\\/g, '/')
  const segments = normalized.split('/').filter(Boolean)
  const claudeIndex = segments.indexOf('.claude')
  if (claudeIndex > 0) {
    return segments[claudeIndex - 1]
  }
  return 'project'
}

export function getSourceDisplayName(
  type: SourceType,
  sourcePath?: string,
  pluginName?: string | null,
  isSynced?: boolean
): string {
  switch (type) {
    case 'global':
      return isSynced ? 'synced' : 'global'
    case 'project':
      return getProjectNameFromPath(sourcePath)
    case 'plugin':
      return getPluginBareName(pluginName)
  }
}

export function getSourceTooltip(
  type: SourceType,
  sourcePath?: string,
  pluginName?: string | null,
  isSynced?: boolean
): string {
  switch (type) {
    case 'global':
      return isSynced ? 'Synced from claude.ai' : 'Global skill'
    case 'project':
      return sourcePath ?? 'Project skill'
    case 'plugin':
      return pluginName ? `Plugin: ${pluginName}` : 'Plugin skill'
  }
}

const TYPE_ORDER: Record<SourceType, number> = {
  global: 0,
  project: 1,
  plugin: 2
}

export function getSourceSortKey(
  type: SourceType,
  sourcePath?: string,
  pluginName?: string | null,
  isSynced?: boolean
): string {
  const order = TYPE_ORDER[type]
  const displayName = getSourceDisplayName(type, sourcePath, pluginName, isSynced).toLowerCase()
  return `${order}_${displayName}`
}
