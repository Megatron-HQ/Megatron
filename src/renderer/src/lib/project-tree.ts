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

export function projectDisplayLabels(paths: Iterable<string>): Map<string, string> {
  const groups = new Map<string, Map<string, string>>()
  for (const path of paths) {
    const key = normalizeProjectPath(path)
    const name = getFolderBasename(key)
    const group = groups.get(name) ?? new Map<string, string>()
    group.set(key, path)
    groups.set(name, group)
  }
  const labels = new Map<string, string>()
  for (const group of groups.values()) {
    const keys = [...group.keys()].map((key) => key.split('/'))
    let common = 0
    if (keys.length > 1) {
      while (
        common < keys[0].length - 1 &&
        keys.every((parts) => parts[common] === keys[0][common])
      )
        common++
    }
    for (const [key, path] of group)
      labels.set(
        key,
        group.size === 1
          ? getFolderBasename(path)
          : path.replace(/\\/g, '/').replace(/\/+$/, '').split('/').slice(common).join('/')
      )
  }
  return labels
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
  const grantNodes = [...grantKeys]
    .map((key) => nodes.get(key)!)
    .sort((first, second) => second.key.length - first.key.length)
  for (const node of nodes.values()) {
    const parent = grantNodes.find(
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
      if (labelCounts.get(node.label)! > 1) {
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
