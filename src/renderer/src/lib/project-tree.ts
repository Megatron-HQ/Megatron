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
  status: ProjectFolder['status'] | undefined
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

export type ProjectLabelResolver = (path: string) => string

export function createProjectAvailabilityResolver(
  catalog: ProjectFolder[],
  grants: AllowedPathRow[]
): (path: string | undefined) => ProjectFolder['status'] | undefined {
  const statuses = new Map(
    catalog.map((project) => [normalizeProjectPath(project.path), project.status])
  )
  return (path) => {
    if (path === undefined) return undefined
    const confirmed = statuses.get(normalizeProjectPath(path))
    if (confirmed !== undefined) return confirmed
    // A grant permits discovery; it does not establish that a scan has failed.
    return grants.some((grant) => isWithinProjectPath(path, grant.path))
      ? undefined
      : 'needs_access'
  }
}

export function resolveProjectSelection(
  path: string,
  catalog: ProjectFolder[]
): string | undefined {
  if (catalog.some((entry) => normalizeProjectPath(entry.path) === normalizeProjectPath(path)))
    return path
  return catalog
    .filter((entry) => entry.status === 'available' && isWithinProjectPath(path, entry.path))
    .sort((first, second) => second.path.length - first.path.length)[0]?.path
}

export function createProjectLabelResolver(
  labels: ReadonlyMap<string, string>,
  grants: AllowedPathRow[] = []
): ProjectLabelResolver {
  const roots = [...labels.keys()].sort((first, second) => second.length - first.length)
  return (path) => {
    if (!path) return 'Unknown project'
    const key = normalizeProjectPath(path)
    const exactLabel = labels.get(key)
    if (exactLabel !== undefined) return exactLabel
    const grantedFolder = grants.find((grant) => normalizeProjectPath(grant.path) === key)
    if (grantedFolder !== undefined) return getFolderBasename(grantedFolder.path)

    // Invocation working directories can be below the repository root.
    const root = roots.find((candidate) => isWithinProjectPath(path, candidate))
    if (root !== undefined) return labels.get(root)!
    return projectDisplayLabels([path], grants).get(key) ?? getFolderBasename(path)
  }
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
  const availability = createProjectAvailabilityResolver(catalog, grants)
  const grantKeys = new Set(grants.map((grant) => normalizeProjectPath(grant.path)))
  const insert = (project: Pick<ProjectTreeNode, 'path' | 'kind' | 'status'>): ProjectTreeNode => {
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
  for (const grant of grants)
    insert({ path: grant.path, kind: 'folder', status: availability(grant.path) })
  for (const entry of counts) {
    const node = insert({
      path: entry.path,
      kind: 'repository',
      status: availability(entry.path)
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
