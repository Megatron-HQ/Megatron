import type { SkillFile } from '../../../shared/ipc'

export const TREE_WIDTH_DEFAULT = 240
export const TREE_WIDTH_MIN = 200
export const TREE_WIDTH_MAX = 480
export const TREE_WIDTH_STEP = 16

export interface TreeNode {
  id: string
  label: string
  depth: number
  isDirectory: boolean
  file: SkillFile | null
  children: TreeNode[]
}

export interface FlatRow {
  node: TreeNode
  siblingIndex: number
  siblingCount: number
}

const SKILL_MD = 'SKILL.md'

function compareNodes(a: TreeNode, b: TreeNode): number {
  if (a.label === SKILL_MD && a.depth === 0) return -1
  if (b.label === SKILL_MD && b.depth === 0) return 1
  if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
  return a.label.localeCompare(b.label)
}

function sortTree(nodes: TreeNode[]): void {
  nodes.sort(compareNodes)
  for (const node of nodes) {
    if (node.children.length > 0) sortTree(node.children)
  }
}

export function buildTree(files: SkillFile[]): TreeNode[] {
  const roots: TreeNode[] = []
  const directories = new Map<string, TreeNode>()

  function getOrCreateDirectory(
    path: string,
    depth: number,
    label: string,
    parentPath: string
  ): TreeNode {
    const existing = directories.get(path)
    if (existing) return existing

    const node: TreeNode = { id: path, label, depth, isDirectory: true, file: null, children: [] }
    directories.set(path, node)

    if (parentPath) {
      directories.get(parentPath)!.children.push(node)
    } else {
      roots.push(node)
    }

    return node
  }

  for (const file of files) {
    const segments = file.relativePath.split('/')
    const dirSegments = segments.slice(0, -1)
    const label = segments[segments.length - 1]

    let pathSoFar = ''
    dirSegments.forEach((segment, depth) => {
      const parentPath = pathSoFar
      pathSoFar = pathSoFar ? `${pathSoFar}/${segment}` : segment
      getOrCreateDirectory(pathSoFar, depth, segment, parentPath)
    })

    const fileNode: TreeNode = {
      id: file.relativePath,
      label,
      depth: dirSegments.length,
      isDirectory: false,
      file,
      children: []
    }

    const parentPath = dirSegments.join('/')
    if (parentPath) {
      directories.get(parentPath)!.children.push(fileNode)
    } else {
      roots.push(fileNode)
    }
  }

  sortTree(roots)
  return roots
}

function nodeMatches(node: TreeNode, query: string): boolean {
  return node.label.toLowerCase().includes(query)
}

export function collectMatchingIds(nodes: TreeNode[], query: string): Set<string> | null {
  const trimmed = query.trim().toLowerCase()
  if (!trimmed) return null

  const matching = new Set<string>()

  function visit(node: TreeNode): boolean {
    const childMatches = node.children.map(visit)
    const hasMatch = nodeMatches(node, trimmed) || childMatches.some(Boolean)
    if (hasMatch) matching.add(node.id)
    return hasMatch
  }

  for (const node of nodes) visit(node)
  return matching
}

export function flattenVisible(
  nodes: TreeNode[],
  expandedIds: Set<string>,
  matchingIds: Set<string> | null
): FlatRow[] {
  const rows: FlatRow[] = []

  function visit(siblings: TreeNode[]): void {
    const visibleSiblings = matchingIds
      ? siblings.filter((node) => matchingIds.has(node.id))
      : siblings

    visibleSiblings.forEach((node, index) => {
      rows.push({ node, siblingIndex: index, siblingCount: visibleSiblings.length })
      // A directory surviving the matchingIds filter is guaranteed relevant
      // (it matched, or a descendant did) — always reveal it while searching,
      // regardless of manual expandedIds state.
      const shouldRecurse = node.isDirectory && (matchingIds !== null || expandedIds.has(node.id))
      if (shouldRecurse) {
        visit(node.children)
      }
    })
  }

  visit(nodes)
  return rows
}
