import type { AllowedPathRow, ProjectFolder } from '../../../shared/ipc'
import { isWithinProjectPath, normalizeProjectPath } from '../../../shared/project-path'
import { getFolderBasename } from './source-name'

export interface ProjectTreeNode {
  key: string
  path: string
  label: string
  count: number
  directCount: number
  kind: ProjectFolder['kind']
  status: ProjectFolder['status']
  children: ProjectTreeNode[]
}

export interface ProjectCountEntry {
  path: string
  count: number
}

interface ProjectLabelEntry {
  parts: string[]
  start: number
}

export function projectDisplayLabels(
  paths: Iterable<string>,
  grants: AllowedPathRow[] = []
): Map<string, string> {
  const entries = new Map<string, ProjectLabelEntry>()
  const anchors = [...grants].sort(
    (a, b) => normalizeProjectPath(a.path).length - normalizeProjectPath(b.path).length
  )
  for (const path of paths) {
    const key = normalizeProjectPath(path)
    if (entries.has(key)) continue
    const parts = path.replace(/\\/g, '/').replace(/\/+$/, '').split('/')
    const anchor = anchors.find((grant) => isWithinProjectPath(path, grant.path))
    const anchorDepth = anchor?.path.replace(/\\/g, '/').replace(/\/+$/, '').split('/').length
    entries.set(key, {
      parts,
      start: Math.max(
        0,
        anchorDepth === undefined ? parts.length - 2 : Math.min(anchorDepth - 1, parts.length - 2)
      )
    })
  }
  // Include more ancestors only when the local hierarchy still leaves duplicate labels.
  let expanded: boolean
  do {
    expanded = false
    const groups = new Map<string, ProjectLabelEntry[]>()
    for (const entry of entries.values()) {
      const label = entry.parts.slice(entry.start).join('/').toLowerCase()
      const group = groups.get(label) ?? []
      group.push(entry)
      groups.set(label, group)
    }
    for (const group of groups.values()) {
      if (group.length < 2) continue
      for (const entry of group) {
        if (entry.start === 0) continue
        entry.start--
        expanded = true
      }
    }
  } while (expanded)
  return new Map(
    [...entries].map(([key, entry]) => [key, entry.parts.slice(entry.start).join('/')])
  )
}

export function buildProjectTree(
  grants: AllowedPathRow[],
  catalog: ProjectFolder[],
  counts: ProjectCountEntry[]
): ProjectTreeNode[] {
  const nodes = new Map<string, ProjectTreeNode>()
  const grantKeys = new Set(grants.map((grant) => normalizeProjectPath(grant.path)))
  const insert = (project: ProjectFolder): ProjectTreeNode => {
    const key = normalizeProjectPath(project.path)
    const node = nodes.get(key) ?? {
      ...project,
      key,
      label: getFolderBasename(project.path),
      count: 0,
      directCount: 0,
      children: []
    }
    nodes.set(key, node)
    return node
  }
  for (const project of catalog) {
    if (project.kind === 'repository' || grantKeys.has(normalizeProjectPath(project.path)))
      insert(project)
  }
  for (const grant of grants) insert({ path: grant.path, kind: 'folder', status: 'unavailable' })
  for (const entry of counts) {
    const covered = grants.some((grant) => isWithinProjectPath(entry.path, grant.path))
    const node = insert({
      path: entry.path,
      kind: 'repository',
      status: covered ? 'unavailable' : 'needs_access'
    })
    node.directCount += entry.count
  }
  const roots: ProjectTreeNode[] = []
  const ancestors = [...nodes.values()].sort(
    (first, second) => second.key.length - first.key.length
  )
  for (const node of nodes.values()) {
    const parent = ancestors.find(
      (candidate) => candidate.key !== node.key && isWithinProjectPath(node.path, candidate.path)
    )
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  function summarize(siblings: ProjectTreeNode[], parent?: ProjectTreeNode): void {
    const labelCounts = new Map<string, number>()
    for (const node of siblings) labelCounts.set(node.label, (labelCounts.get(node.label) ?? 0) + 1)
    for (const node of siblings) {
      summarize(node.children, node)
      node.count = node.directCount + node.children.reduce((sum, child) => sum + child.count, 0)
      if (
        node.status === 'available' &&
        node.children.some((child) => child.status !== 'available')
      )
        node.status = 'unavailable'
      if (parent || labelCounts.get(node.label)! > 1) {
        const fullPath = node.path.replace(/\\/g, '/')
        node.label = parent
          ? fullPath.slice(normalizeProjectPath(parent.path).length + 1)
          : fullPath
      }
    }
    siblings.sort(
      (first, second) =>
        first.label.localeCompare(second.label) || first.key.localeCompare(second.key)
    )
  }
  summarize(roots)
  return roots
}
