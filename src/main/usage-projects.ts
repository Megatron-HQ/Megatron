import type { UsageProject, UsageProjectCatalog } from '../shared/usage-projects'
import {
  isClaudeAppScratchPath,
  groupProjectCounts,
  groupProjectSpending,
  groupProjectMonths,
  groupProjectTokens
} from '../shared/usage-projects'
import {
  primaryUsageProject,
  type ProjectIdentity,
  type ProjectIdentitySnapshot
} from '../shared/project-identity'
import { normalizeProjectPath } from '../shared/project-path'
import type Database from 'better-sqlite3'
import type {
  UsageOverview,
  UsageCalendar,
  UsageDayDetails,
  ActivityWindow,
  CostWindow,
  TokenWindow
} from '../shared/ipc'
import {
  getArchivedActivityStats,
  getTokenStats,
  getUsageCalendar,
  getUsageDay
} from './db/usage-history-queries'
import { getCostStats, getModelStats, getSkillStats } from './db/queries'

function groupActivityWindow<T extends ActivityWindow>(window: T, identity: ProjectIdentity): T {
  return {
    ...window,
    byProject: groupProjectCounts(window.byProject, identity),
    byDay: window.byDay.map((day) => ({
      ...day,
      byProject: groupProjectCounts(day.byProject, identity)
    }))
  }
}

function groupCostWindow(window: CostWindow, identity: ProjectIdentity): CostWindow {
  return {
    ...window,
    byProject: groupProjectSpending(window.byProject, identity),
    byDay: window.byDay.map((day) => ({
      ...day,
      byProject: groupProjectSpending(day.byProject, identity)
    })),
    byHourChronological: window.byHourChronological.map((hour) => ({
      ...hour,
      byProject: groupProjectSpending(hour.byProject, identity)
    }))
  }
}

function groupTokenWindow(window: TokenWindow, identity: ProjectIdentity): TokenWindow {
  return {
    ...window,
    byProject: groupProjectTokens(window.byProject, identity),
    trend: window.trend.map((bucket) => ({
      ...bucket,
      byProject: groupProjectTokens(bucket.byProject, identity)
    }))
  }
}

export function getUsageOverviewData(
  index: Database.Database,
  archive: Database.Database,
  identity: ProjectIdentity,
  now: Date = new Date()
): Omit<UsageOverview, 'scanComplete' | 'scanSummary'> {
  const activity = getArchivedActivityStats(archive, now)
  const tokens = getTokenStats(archive, now)
  const cost = getCostStats(index, now)
  return {
    activity: {
      ...activity,
      last24h: {
        ...groupActivityWindow(activity.last24h, identity),
        hourlyTrend: activity.last24h.hourlyTrend.map((hour) => ({
          ...hour,
          byProject: groupProjectCounts(hour.byProject, identity)
        }))
      },
      last7d: groupActivityWindow(activity.last7d, identity),
      last30d: groupActivityWindow(activity.last30d, identity)
    },
    tokens: {
      ...tokens,
      last24h: groupTokenWindow(tokens.last24h, identity),
      last7d: groupTokenWindow(tokens.last7d, identity),
      last30d: groupTokenWindow(tokens.last30d, identity)
    },
    cost: cost
      ? {
          ...cost,
          last24h: groupCostWindow(cost.last24h, identity),
          last7d: groupCostWindow(cost.last7d, identity),
          last30d: groupCostWindow(cost.last30d, identity)
        }
      : null,
    models: getModelStats(index, now),
    skills: getSkillStats(index, identity, now)
  }
}

export function getProjectUsageCalendar(
  archive: Database.Database,
  year: number,
  identity: ProjectIdentity,
  now: Date = new Date()
): UsageCalendar {
  const calendar = getUsageCalendar(archive, year, now)
  return { ...calendar, byProject: groupProjectMonths(calendar.byProject, identity) }
}

export function getProjectUsageDay(
  archive: Database.Database,
  date: string,
  identity: ProjectIdentity,
  now: Date = new Date()
): UsageDayDetails {
  const day = getUsageDay(archive, date, now)
  return { ...day, byProject: groupProjectCounts(day.byProject, identity) }
}

// Every working directory a Session ran in, from the index and from the archive that outlives it.
export function usageSessionPaths(index: Database.Database, archive: Database.Database): string[] {
  const archived = archive
    .prepare(
      'SELECT DISTINCT project FROM history_prompts UNION SELECT project FROM history_sessions'
    )
    .pluck()
    .all() as string[]
  const current = index
    .prepare(
      'SELECT DISTINCT cwd AS project FROM sessions_meta UNION SELECT project FROM prompt_history'
    )
    .pluck()
    .all() as string[]
  return [...archived, ...current]
}

function basename(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop() || path
}

type ClaudeAppChat = NonNullable<UsageProject['chat']>

// Keyed by normalized chat folder. The title is the newest titled transcript's; the start is the
// earliest the index or the archive knows, so a chat whose transcripts were pruned keeps its date.
export function readClaudeAppChats(
  index: Database.Database,
  archive: Database.Database
): Map<string, ClaudeAppChat> {
  const chats = new Map<string, ClaudeAppChat>()
  const sessions = [
    ...(index
      .prepare(
        `SELECT cwd AS project, started_at, title FROM sessions_meta
         ORDER BY source_mtime_ms DESC`
      )
      .all() as Array<{ project: string; started_at: string; title: string | null }>),
    ...(archive
      .prepare('SELECT project, started_at, NULL AS title FROM history_sessions')
      .all() as Array<{ project: string; started_at: string; title: null }>)
  ]
  for (const session of sessions) {
    if (!isClaudeAppScratchPath(session.project)) continue
    const key = normalizeProjectPath(session.project)
    const chat = chats.get(key) ?? { title: null, startedAt: null }
    chat.title ??= session.title
    if (chat.startedAt === null || session.started_at < chat.startedAt)
      chat.startedAt = session.started_at
    chats.set(key, chat)
  }
  return chats
}

// chats only decorates the returned projects; locations, which the owner persists, never carry it.
export function usageProjectCatalog(
  snapshot: ProjectIdentitySnapshot,
  chats: Map<string, ClaudeAppChat> = new Map()
): UsageProjectCatalog {
  const { locations } = snapshot
  const roots = locations.filter((entry) => !entry.linkedTo)
  const labels = roots.map((entry) => ({
    entry,
    parts: entry.path.replace(/\\/g, '/').replace(/\/+$/, '').split('/').filter(Boolean),
    depth: 1
  }))
  let changed: boolean
  do {
    changed = false
    const collisions = new Map<string, typeof labels>()
    for (const label of labels) {
      const key = label.parts.slice(-label.depth).join('/').toLowerCase()
      collisions.set(key, [...(collisions.get(key) ?? []), label])
    }
    for (const group of collisions.values())
      if (group.length > 1)
        for (const label of group) {
          if (label.depth >= label.parts.length) continue
          label.depth++
          changed = true
        }
  } while (changed)
  return {
    ...snapshot,
    projects: labels
      .map(({ entry, parts, depth }) => ({
        id: entry.id,
        path: entry.path,
        label: parts.slice(-depth).join('/') || basename(entry.path),
        locations: locations.filter(
          (location) => primaryUsageProject(location, locations).id === entry.id
        ),
        possibleMatches: roots
          .filter(
            (candidate) =>
              candidate.id !== entry.id &&
              basename(candidate.path).toLowerCase() === basename(entry.path).toLowerCase()
          )
          .map((candidate) => candidate.id),
        ...(isClaudeAppScratchPath(entry.path)
          ? {
              chat: chats.get(normalizeProjectPath(entry.path)) ?? {
                title: null,
                startedAt: null
              }
            }
          : {})
      }))
      .sort((a, b) => a.label.localeCompare(b.label) || a.path.localeCompare(b.path))
  }
}
