import { normalizeProjectPath } from '../../../shared/project-path'
import type { ProjectLabelResolver } from './project-tree'
import { getFolderBasename } from './source-name'

interface UsageProjectLabel {
  parts: string[]
  depth: number
}

function projectRoot(path: string, resolveHierarchyLabel: ProjectLabelResolver): string {
  const label = resolveHierarchyLabel(path)
  let root = path.replace(/\\/g, '/').replace(/\/+$/, '') || '/'

  // Keep the existing nearest-repository naming for sessions started in subdirectories.
  while (root !== '/') {
    const separator = root.lastIndexOf('/')
    if (separator < 0) break
    const parent = root.slice(0, separator) || '/'
    if (resolveHierarchyLabel(parent) !== label) break
    root = parent
  }
  return root
}

function displayLabel(entry: UsageProjectLabel): string {
  return entry.parts.slice(-entry.depth).join('/')
}

export function createUsageProjectLabelResolver(
  paths: Iterable<string>,
  resolveHierarchyLabel: ProjectLabelResolver
): ProjectLabelResolver {
  const projects = new Map<string, UsageProjectLabel>()
  const projectKeys = new Map<string, string>()

  for (const path of paths) {
    if (!path) continue
    const root = projectRoot(path, resolveHierarchyLabel)
    const key = normalizeProjectPath(root)
    projectKeys.set(normalizeProjectPath(path), key)
    if (projects.has(key)) continue

    const parts = root.split('/').filter(Boolean)
    const name = getFolderBasename(resolveHierarchyLabel(path)) || getFolderBasename(root)
    if (parts.length === 0) parts.push(name)
    else parts[parts.length - 1] = name
    projects.set(key, { parts, depth: 1 })
  }

  let expanded: boolean
  do {
    expanded = false
    const groups = new Map<string, UsageProjectLabel[]>()
    for (const entry of projects.values()) {
      const label = displayLabel(entry).toLowerCase()
      const group = groups.get(label) ?? []
      group.push(entry)
      groups.set(label, group)
    }
    for (const group of groups.values()) {
      if (group.length < 2) continue
      for (const entry of group) {
        if (entry.depth === entry.parts.length) continue
        entry.depth++
        expanded = true
      }
    }
  } while (expanded)

  return (path) => {
    if (!path) return resolveHierarchyLabel(path)
    const key = projectKeys.get(normalizeProjectPath(path))
    const entry = key === undefined ? undefined : projects.get(key)
    return entry
      ? displayLabel(entry)
      : getFolderBasename(resolveHierarchyLabel(path)) || getFolderBasename(path)
  }
}
