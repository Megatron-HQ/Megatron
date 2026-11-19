import type { WorktreeLink } from './ipc'
import { isGitDirectoryPath, isWithinProjectPath, normalizeProjectPath } from './project-path'
import type { UsageProjectLocation } from './usage-projects'

// Plain data, so it crosses workerData and IPC. Main's owner (src/main/project-identity.ts) is the
// only writer of the locations; every other process reads them through readProjectIdentity.
export interface ProjectIdentitySnapshot {
  locations: UsageProjectLocation[]
  // The active Claude Code Folder and ~/.claude: their own worktrees/ folder is not a repo layout.
  claudeCodeFolders: string[]
}

// `path` is the Canonical Checkout plus the asked path's subpath inside the Worktree, so a monorepo
// package inside a Worktree still lands on the same package in the Canonical Checkout.
export interface CheckoutMatch {
  worktree: string
  canonical: string
  path: string
}

// The two questions have different rules on purpose (see docs/data-model.md): Project Skills
// follow proven Project Links only, Usage follows manual ones too.
export interface ProjectIdentity {
  checkoutOf(path: string): CheckoutMatch | null
  usageProjectOf(path: string): UsageProjectLocation | undefined
}

// `claude --worktree <name>` creates the checkout at <repo>/.claude/worktrees/<name>, a folder
// Claude Code owns for that repo, so the layout alone proves the link without reading git.
// Verified against real ~/.claude 2026-11-15.
const NATIVE_WORKTREE_PATH = /^(.+?)[\\/]\.claude[\\/]worktrees[\\/][^\\/]+/i

// Owner-only: reconciliation reads the layout as evidence ('project') and clears links the excluded
// Claude Code Folder layout implied ('config').
export function nativeWorktreeRoot(
  path: string,
  scope: 'project' | 'config',
  claudeCodeFolders: readonly string[]
): WorktreeLink | null {
  const match = NATIVE_WORKTREE_PATH.exec(path)
  if (!match || isGitDirectoryPath(match[1])) return null
  const layoutFolder = normalizeProjectPath(match[1] + '/.claude')
  const inConfig = claudeCodeFolders.some((folder) => normalizeProjectPath(folder) === layoutFolder)
  return (scope === 'config') === inConfig ? { path: match[0], canonical: match[1] } : null
}

// Owner-only. A saved link may not point into Git metadata, nor rest on the excluded layout alone.
export function invalidWorktreeTarget(
  entry: UsageProjectLocation,
  canonical: UsageProjectLocation,
  claudeCodeFolders: readonly string[]
): boolean {
  if (isGitDirectoryPath(canonical.path)) return true
  if (entry.worktreeEvidence === 'git') return false
  const layout = nativeWorktreeRoot(entry.path, 'config', claudeCodeFolders)
  return (
    layout !== null &&
    normalizeProjectPath(layout.canonical) === normalizeProjectPath(canonical.path)
  )
}

// Owner-only, like the next one: reconciliation walks the same location graph Usage reads.
export function usageProjectOwner(
  path: string,
  locations: UsageProjectLocation[]
): UsageProjectLocation | undefined {
  const key = normalizeProjectPath(path)
  return locations
    .filter(
      (entry) =>
        normalizeProjectPath(entry.path) === key ||
        ((entry.kind === 'repository' || (entry.linkedTo && !entry.inferredOwner)) &&
          isWithinProjectPath(path, entry.path))
    )
    .sort((first, second) => second.path.length - first.path.length)[0]
}

export function primaryUsageProject(
  location: UsageProjectLocation,
  locations: UsageProjectLocation[]
): UsageProjectLocation {
  const visited = new Set<string>()
  let current = location
  while (current.linkedTo) {
    if (visited.has(current.id)) return location
    visited.add(current.id)
    const next = locations.find((entry) => entry.id === current.linkedTo)
    if (!next) return location
    current = next
  }
  return current
}

function provenLinks(snapshot: ProjectIdentitySnapshot): WorktreeLink[] {
  const byId = new Map(snapshot.locations.map((entry) => [entry.id, entry]))
  const targetOf = (entry: UsageProjectLocation): UsageProjectLocation | undefined => {
    const canonical = entry.worktree && entry.linkedTo ? byId.get(entry.linkedTo) : undefined
    return canonical && !invalidWorktreeTarget(entry, canonical, snapshot.claudeCodeFolders)
      ? canonical
      : undefined
  }
  return snapshot.locations.flatMap((entry) => {
    let canonical = targetOf(entry)
    if (!canonical) return []
    // A formerly canonical checkout can become a worktree while older, pruned links still name it.
    const seen = new Set([entry.id])
    for (let next = targetOf(canonical); next && !seen.has(next.id); next = targetOf(next)) {
      seen.add(canonical.id)
      canonical = next
    }
    return [{ path: entry.path, canonical: canonical.path }]
  })
}

// `scanLinks` are this Scan's own links, not yet recorded; they win over a saved link for the same
// Worktree.
export function readProjectIdentity(
  snapshot: ProjectIdentitySnapshot,
  scanLinks: readonly WorktreeLink[] = []
): ProjectIdentity {
  // Deepest first; the sort is stable, so this Scan's links stay ahead of saved ones.
  const links = [...scanLinks, ...provenLinks(snapshot)]
    .map((link) => ({ ...link, key: normalizeProjectPath(link.path) }))
    .sort((a, b) => b.key.length - a.key.length)
  return {
    checkoutOf(path) {
      const link =
        links.find(
          (entry) =>
            isWithinProjectPath(path, entry.path) &&
            // A bare container can be an ancestor of its own Canonical Checkout.
            !(
              isWithinProjectPath(entry.canonical, entry.path) &&
              isWithinProjectPath(path, entry.canonical)
            )
        ) ?? nativeWorktreeRoot(path, 'project', snapshot.claudeCodeFolders)
      if (!link) return null
      return {
        worktree: link.path,
        canonical: link.canonical,
        path:
          link.canonical + normalizeProjectPath(path).slice(normalizeProjectPath(link.path).length)
      }
    },
    usageProjectOf(path) {
      if (!path) return undefined
      const owner = usageProjectOwner(path, snapshot.locations)
      return owner && primaryUsageProject(owner, snapshot.locations)
    }
  }
}
