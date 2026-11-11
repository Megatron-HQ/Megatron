import type { AllowedPathRow, ProjectFolder } from '../../../shared/ipc'
import { isWithinProjectPath, normalizeProjectPath } from '../../../shared/project-path'
import { getFolderBasename } from './source-name'

export interface ProjectTreeNode {
  key: string
  path: string
  label: string
  count: number
  directCount: number
  // 'group' is a folder that is neither granted nor a project, shown only because it holds two or
  // more rows; it carries no status of its own.
  kind: ProjectFolder['kind'] | 'group'
  status: ProjectFolder['status'] | undefined
  children: ProjectTreeNode[]
  // Normalized paths of folders folded into this row's label, or hidden above a root, so a
  // selection made on one of them still lands on this row.
  chain: string[]
  defaultExpanded: boolean
  // Never folded away as an empty row: a grant, a warning, or an ancestor of either.
  pinned: boolean
}

export interface ProjectCountEntry {
  path: string
  count: number
}

export interface ProjectSelection {
  path?: string
  exact?: boolean
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
    return getFolderBasename(path)
  }
}

// Name first; parent folders are added only to names that clash, case-insensitively because both
// supported filesystems usually are. A chain that runs out shows the whole path.
export function projectDisplayLabels(paths: Iterable<string>): Map<string, string> {
  const entries = new Map<string, { parts: string[]; start: number }>()
  for (const path of paths) {
    const key = normalizeProjectPath(path)
    if (entries.has(key)) continue
    const parts = displaySegments(path)
    entries.set(key, { parts, start: Math.max(0, parts.length - 1) })
  }
  let expanded: boolean
  do {
    expanded = false
    const groups = new Map<string, { start: number }[]>()
    for (const entry of entries.values()) {
      const label = entry.parts.slice(entry.start).join('/').toLowerCase()
      groups.set(label, [...(groups.get(label) ?? []), entry])
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

function displaySegments(path: string): string[] {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').split('/')
}

// Drive letters and UNC shares compare case-insensitively, matching normalizeProjectPath.
function segmentKeys(segments: string[]): string[] {
  const insensitive = /^(?:[a-z]:|\/\/)/i.test(segments.join('/'))
  return insensitive ? segments.map((segment) => segment.toLowerCase()) : segments
}

// `/`, `C:` or `//server/share`: the part of a path no row is ever generated for.
function filesystemRootLength(segments: string[]): number {
  return segments[0] === '' && segments[1] === '' ? 4 : 1
}

interface TrieItem {
  node: ProjectTreeNode
  display: string[]
  keys: string[]
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

export function buildProjectTree(
  grants: AllowedPathRow[],
  catalog: ProjectFolder[],
  counts: ProjectCountEntry[],
  { home }: { home?: string } = {}
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
      children: [],
      chain: [],
      defaultExpanded: false,
      pinned: false
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

  const realChildren = new Map<ProjectTreeNode, ProjectTreeNode[]>()
  const realRoots: ProjectTreeNode[] = []
  const ancestors = [...nodes.values()].sort(
    (first, second) => second.key.length - first.key.length
  )
  for (const node of nodes.values()) {
    const parent = ancestors.find(
      (candidate) => candidate.key !== node.key && isWithinProjectPath(node.path, candidate.path)
    )
    if (parent) realChildren.set(parent, [...(realChildren.get(parent) ?? []), node])
    else realRoots.push(node)
  }

  const item = (node: ProjectTreeNode): TrieItem => {
    const display = displaySegments(node.path)
    return { node, display, keys: segmentKeys(display) }
  }
  const prefixKey = (entry: TrieItem, end: number): string =>
    normalizeProjectPath(entry.display.slice(0, end).join('/'))
  const chainBetween = (entry: TrieItem, start: number, end: number): string[] =>
    Array.from({ length: Math.max(0, end - start) }, (_, offset) =>
      prefixKey(entry, start + offset + 1)
    )

  // One radix-trie rule for every sibling set: a folder that isn't real becomes a row only when it
  // holds two or more rows; otherwise it folds into its single child's label (`me/dotfiles`).
  // Runs of shared folders compact into one row, as in VS Code's compact folders.
  function group(items: TrieItem[], start: number, realAncestor: boolean): ProjectTreeNode[] {
    const buckets = new Map<string, TrieItem[]>()
    const rows: ProjectTreeNode[] = []
    for (const entry of items) {
      if (entry.keys.length <= start) rows.push(arrange(entry.node))
      else buckets.set(entry.keys[start], [...(buckets.get(entry.keys[start]) ?? []), entry])
    }
    for (const bucket of buckets.values()) {
      const first = bucket[0]
      if (bucket.length === 1) {
        const node = arrange(first.node)
        node.label = first.display.slice(start).join('/')
        node.chain = chainBetween(first, start, first.keys.length - 1)
        rows.push(node)
        continue
      }
      // The generated row spans segments [start, end).
      let end = start + 1
      while (
        bucket.every((entry) => entry.keys.length > end + 1 && entry.keys[end] === first.keys[end])
      )
        end++
      const path = first.display.slice(0, end).join(first.node.path.includes('\\') ? '\\' : '/')
      rows.push({
        key: normalizeProjectPath(path),
        path,
        label: first.display.slice(start, end).join('/'),
        count: 0,
        directCount: 0,
        kind: 'group',
        status: undefined,
        children: group(bucket, end, realAncestor),
        chain: chainBetween(first, start, end - 1),
        defaultExpanded: !realAncestor,
        pinned: false
      })
    }
    return rows
  }

  function arrange(node: ProjectTreeNode): ProjectTreeNode {
    const children = realChildren.get(node) ?? []
    node.children = group(children.map(item), displaySegments(node.path).length, true)
    return node
  }

  // Roots are measured from home when under it, otherwise from the filesystem root or share, so
  // the folders above a root stay hidden and a lone root shows only its name.
  const caps = new Map<string, { start: number; items: TrieItem[] }>()
  for (const root of realRoots) {
    const entry = item(root)
    const underHome =
      home !== undefined &&
      isWithinProjectPath(root.path, home) &&
      normalizeProjectPath(root.path) !== normalizeProjectPath(home)
    const start = underHome ? displaySegments(home).length : filesystemRootLength(entry.display)
    const cap = prefixKey(entry, start)
    caps.set(cap, { start, items: [...(caps.get(cap)?.items ?? []), entry] })
  }
  const roots = [...caps.values()].flatMap(({ start, items }) => group(items, start, false))
  const rootLabels = projectDisplayLabels(roots.map((root) => root.path))
  for (const root of roots) root.label = rootLabels.get(root.key)!

  function finish(siblings: ProjectTreeNode[]): void {
    for (const node of siblings) {
      finish(node.children)
      node.count = node.directCount + node.children.reduce((sum, child) => sum + child.count, 0)
      node.pinned =
        grantKeys.has(node.key) ||
        (node.status !== undefined && node.status !== 'available') ||
        node.children.some((child) => child.pinned)
    }
    siblings.sort(
      (first, second) =>
        collator.compare(first.label, second.label) || first.key.localeCompare(second.key)
    )
  }
  finish(roots)
  return roots
}

export function matchesProjectRow(node: ProjectTreeNode, path: string): boolean {
  const key = normalizeProjectPath(path)
  return node.key === key || node.chain.includes(key)
}

function rows(tree: ProjectTreeNode[]): ProjectTreeNode[] {
  return tree.flatMap((node) => [node, ...rows(node.children)])
}

// Q11: rows with nothing to show collapse behind one trailing "N without …" row, unless pinned or
// holding the current selection.
export function partitionFoldedChildren(
  children: ProjectTreeNode[],
  selection?: string
): { visible: ProjectTreeNode[]; folded: ProjectTreeNode[] } {
  const folds = (node: ProjectTreeNode): boolean =>
    node.count === 0 &&
    !node.pinned &&
    !(
      selection !== undefined &&
      (isWithinProjectPath(selection, node.path) || matchesProjectRow(node, selection))
    )
  return {
    visible: children.filter((node) => !folds(node)),
    folded: children.filter(folds)
  }
}

export function findProjectRow(tree: ProjectTreeNode[], path: string): ProjectTreeNode | undefined {
  return rows(tree).find((node) => matchesProjectRow(node, path))
}

// Q13: a selection whose row disappeared (revoked, rescanned, regrouped) moves to the closest
// remaining row instead of silently filtering to nothing.
export function snapProjectSelection(
  tree: ProjectTreeNode[],
  selection: ProjectSelection
): ProjectSelection {
  const path = selection.path
  if (path === undefined || findProjectRow(tree, path)) return selection
  const containing = rows(tree)
    .filter((node) => isWithinProjectPath(path, node.path))
    .sort((first, second) => second.key.length - first.key.length)[0]
  const outermostInside = (nodes: ProjectTreeNode[]): ProjectTreeNode[] =>
    nodes.flatMap((node) =>
      isWithinProjectPath(node.path, path) ? [node] : outermostInside(node.children)
    )
  const inside = outermostInside(tree)
  const target = containing ?? (inside.length === 1 ? inside[0] : undefined)
  return target === undefined
    ? { path: undefined, exact: undefined }
    : { path: target.path, exact: target.children.length === 0 && target.kind === 'repository' }
}
