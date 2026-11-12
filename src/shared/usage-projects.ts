import type {
  ActivityProjectCount,
  CostProjectSpend,
  HistoryProject,
  ProjectFolder,
  TokenBreakdown
} from './ipc'
import { isWithinProjectPath, normalizeProjectPath } from './project-path'

export interface UsageProjectLocation extends ProjectFolder {
  id: string
  linkedTo?: string
  inferredOwner?: boolean
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

export interface UsageProjectCatalog {
  locations: UsageProjectLocation[]
  projects: UsageProject[]
}

export function matchesUsageProjectSearch(query: string, values: Iterable<string>): boolean {
  const needle = query.trim().replace(/\\/g, '/').toLowerCase()
  return [...values].some((value) => value.replace(/\\/g, '/').toLowerCase().includes(needle))
}

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

export function resolveUsageProjectPath(path: string, locations: UsageProjectLocation[]): string {
  if (!path) return path
  const owner = usageProjectOwner(path, locations)
  return owner ? primaryUsageProject(owner, locations).path : path
}

function groupByProject<T>(
  rows: T[],
  locations: UsageProjectLocation[],
  pathOf: (row: T) => string
): Map<string, T[]> {
  const groups = new Map<string, T[]>()
  for (const row of rows) {
    const project = resolveUsageProjectPath(pathOf(row), locations)
    const group = groups.get(project) ?? []
    group.push(row)
    groups.set(project, group)
  }
  return groups
}

export function groupProjectCounts(
  rows: ActivityProjectCount[],
  locations: UsageProjectLocation[]
): ActivityProjectCount[] {
  return [...groupByProject(rows, locations, (row) => row.project)]
    .map(([project, group]) => ({ project, count: group.reduce((sum, row) => sum + row.count, 0) }))
    .sort((a, b) => b.count - a.count || a.project.localeCompare(b.project))
}

export function groupProjectSpending(
  rows: CostProjectSpend[],
  locations: UsageProjectLocation[]
): CostProjectSpend[] {
  return [...groupByProject(rows, locations, (row) => row.project)]
    .map(([project, group]) => ({
      project,
      costUsd: group.reduce((sum, row) => sum + row.costUsd, 0)
    }))
    .sort((a, b) => b.costUsd - a.costUsd || a.project.localeCompare(b.project))
}

export function groupProjectMonths(
  rows: HistoryProject[],
  locations: UsageProjectLocation[]
): HistoryProject[] {
  return [...groupByProject(rows, locations, (row) => row.project)]
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
  locations: UsageProjectLocation[]
): TokenBreakdown[] {
  return [...groupByProject(rows, locations, (row) => row.key)]
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
