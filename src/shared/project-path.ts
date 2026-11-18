import type { WorktreeLink } from './ipc'

export function normalizeProjectPath(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '') || '/'
  return /^(?:[a-z]:|\/\/)/i.test(normalized) ? normalized.toLowerCase() : normalized
}

export function isWithinProjectPath(path: string, parent: string): boolean {
  const candidate = normalizeProjectPath(path)
  const root = normalizeProjectPath(parent)
  return candidate === root || candidate.startsWith(root.endsWith('/') ? root : `${root}/`)
}

export function isGitDirectoryPath(path: string): boolean {
  return normalizeProjectPath(path).split('/').includes('.git')
}

// `claude --worktree <name>` creates the checkout at <repo>/.claude/worktrees/<name>, a folder
// Claude Code owns for that repo, so the layout alone proves the link without reading git.
// Verified against real ~/.claude 2026-11-15.
const NATIVE_WORKTREE_PATH = /^(.+?)[\\/]\.claude[\\/]worktrees[\\/][^\\/]+/i
let claudeCodeFolders = new Set<string>()

export function setClaudeCodeFolders(paths: readonly string[]): void {
  claudeCodeFolders = new Set(paths.map(normalizeProjectPath))
}

export function nativeWorktreeRoot(
  path: string,
  scope: 'project' | 'config' = 'project'
): WorktreeLink | null {
  const match = NATIVE_WORKTREE_PATH.exec(path)
  if (!match || isGitDirectoryPath(match[1])) return null
  const inConfig = claudeCodeFolders.has(normalizeProjectPath(match[1] + '/.claude'))
  return (scope === 'config') === inConfig ? { path: match[0], canonical: match[1] } : null
}

// The deepest stored link containing the path, else Claude Code's own worktree layout.
export function worktreeLinkFor(path: string, links: readonly WorktreeLink[]): WorktreeLink | null {
  return (
    links
      .filter(
        (entry) =>
          isWithinProjectPath(path, entry.path) &&
          // A bare container can be an ancestor of its own Canonical Checkout.
          !(
            isWithinProjectPath(entry.canonical, entry.path) &&
            isWithinProjectPath(path, entry.canonical)
          )
      )
      .sort(
        (a, b) => normalizeProjectPath(b.path).length - normalizeProjectPath(a.path).length
      )[0] ?? nativeWorktreeRoot(path)
  )
}

// Swaps a worktree prefix for its Canonical Checkout and keeps the subpath, so a monorepo
// package inside a worktree still resolves to the same package's project root.
export function canonicalProjectPath(path: string, links: readonly WorktreeLink[]): string {
  const link = worktreeLinkFor(path, links)
  if (!link) return path
  return link.canonical + normalizeProjectPath(path).slice(normalizeProjectPath(link.path).length)
}
