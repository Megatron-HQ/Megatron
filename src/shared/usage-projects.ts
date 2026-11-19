import type {
  ActivityProjectCount,
  CostProjectSpend,
  HistoryProject,
  ProjectFolder,
  TokenBreakdown
} from './ipc'
import type { ProjectIdentity, ProjectIdentitySnapshot } from './project-identity'

export interface UsageProjectLocation extends ProjectFolder {
  id: string
  linkedTo?: string
  inferredOwner?: boolean
  // A git worktree, linked straight to its Canonical Checkout (never flattened to the project's
  // primary): project-skill scoping reads that checkout's path. See CONTEXT.md.
  worktree?: true
  // Older links have no provenance. Real Git evidence can override an excluded Claude layout.
  worktreeEvidence?: 'git'
  // Identifies the common Git directory that proved the link, even if the checkout path is reused.
  worktreeRepository?: string
}

export interface UsageProject {
  id: string
  path: string
  label: string
  locations: UsageProjectLocation[]
  possibleMatches: string[]
  // Set only on a Claude app chat, at read time; never persisted. The title is the chat's own
  // (custom, else AI-generated), so it stays out of preferences.json and the usage archive.
  chat?: { title: string | null; startedAt: string | null }
}

// A Claude desktop chat started without a folder runs in
// <Claude app data>/scratch-workspaces/<id>/<id>/scratch-YYYY-MM-DD-<hex>. The app-data root
// differs by platform and install (macOS Application Support, Windows Roaming, MSIX
// LocalCache\Roaming), so only the tail is matched, with either separator and any case.
const CLAUDE_APP_SCRATCH_PATH =
  /[\\/]claude[\\/]scratch-workspaces[\\/][^\\/]+[\\/][^\\/]+[\\/]scratch-\d{4}-\d{2}-\d{2}-[0-9a-f]+[\\/]?$/i

export function isClaudeAppScratchPath(path: string): boolean {
  return CLAUDE_APP_SCRATCH_PATH.test(path)
}

export interface UsageProjectCatalog extends ProjectIdentitySnapshot {
  projects: UsageProject[]
}

export function matchesUsageProjectSearch(query: string, values: Iterable<string>): boolean {
  const needle = query.trim().replace(/\\/g, '/').toLowerCase()
  return [...values].some((value) => value.replace(/\\/g, '/').toLowerCase().includes(needle))
}

function groupByProject<T>(
  rows: T[],
  identity: ProjectIdentity,
  pathOf: (row: T) => string
): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const row of rows) {
    const path = pathOf(row)
    const project = identity.usageProjectOf(path)?.path ?? path
    const group = groups.get(project) ?? []
    group.push(row)
    groups.set(project, group)
  }
  return groups
}

export function groupProjectCounts(
  rows: ActivityProjectCount[],
  identity: ProjectIdentity
): ActivityProjectCount[] {
  return [...groupByProject(rows, identity, (row) => row.project)]
    .map(([project, group]) => ({ project, count: group.reduce((sum, row) => sum + row.count, 0) }))
    .sort((a, b) => b.count - a.count || a.project.localeCompare(b.project))
}

export function groupProjectSpending(
  rows: CostProjectSpend[],
  identity: ProjectIdentity
): CostProjectSpend[] {
  return [...groupByProject(rows, identity, (row) => row.project)]
    .map(([project, group]) => ({
      project,
      costUsd: group.reduce((sum, row) => sum + row.costUsd, 0)
    }))
    .sort((a, b) => b.costUsd - a.costUsd || a.project.localeCompare(b.project))
}

export function groupProjectMonths(
  rows: HistoryProject[],
  identity: ProjectIdentity
): HistoryProject[] {
  return [...groupByProject(rows, identity, (row) => row.project)]
    .map(([project, group]) => ({
      project,
      total: group.reduce((sum, row) => sum + row.total, 0),
      byMonth: Array.from({ length: 12 }, (_, index) =>
        group.reduce((sum, row) => sum + row.byMonth[index], 0)
      )
    }))
    .sort((a, b) => b.total - a.total || a.project.localeCompare(b.project))
}

export function groupProjectTokens(
  rows: TokenBreakdown[],
  identity: ProjectIdentity
): TokenBreakdown[] {
  return [...groupByProject(rows, identity, (row) => row.key)]
    .map(([key, group]) => ({
      key,
      tokens: group.reduce(
        (sum, row) => ({
          input: sum.input + row.tokens.input,
          output: sum.output + row.tokens.output,
          cacheRead: sum.cacheRead + row.tokens.cacheRead,
          cacheWrite: sum.cacheWrite + row.tokens.cacheWrite,
          total: sum.total + row.tokens.total
        }),
        { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
      )
    }))
    .sort((a, b) => b.tokens.total - a.tokens.total || a.key.localeCompare(b.key))
}
