import type { ProjectFolder } from '../shared/ipc'
import type {
  UsageProject,
  UsageProjectCatalog,
  UsageProjectLocation
} from '../shared/usage-projects'
import {
  isClaudeAppScratchPath,
  primaryUsageProject,
  usageProjectOwner,
  groupProjectCounts,
  groupProjectSpending,
  groupProjectMonths,
  groupProjectTokens
} from '../shared/usage-projects'
import { normalizeProjectPath, isWithinProjectPath } from '../shared/project-path'
import { randomUUID } from 'crypto'
import type Database from 'better-sqlite3'
import type {
  UsageOverview,
  UsageCalendar,
  UsageDayDetails,
  ActivityWindow,
  CostWindow
} from '../shared/ipc'
import {
  getArchivedActivityStats,
  getTokenStats,
  getUsageCalendar,
  getUsageDay
} from './db/usage-history-queries'
import { getCostStats, getModelStats, getSkillStats } from './db/queries'
import { isPathAllowed, readAllowedDirectory, allowedStatSync } from './permissions'

function groupActivityWindow<T extends ActivityWindow>(
  window: T,
  locations: UsageProjectLocation[]
): T {
  return {
    ...window,
    byProject: groupProjectCounts(window.byProject, locations),
    byDay: window.byDay.map((day) => ({
      ...day,
      byProject: groupProjectCounts(day.byProject, locations)
    }))
  }
}

function groupCostWindow(window: CostWindow, locations: UsageProjectLocation[]): CostWindow {
  return {
    ...window,
    byProject: groupProjectSpending(window.byProject, locations),
    byDay: window.byDay.map((day) => ({
      ...day,
      byProject: groupProjectSpending(day.byProject, locations)
    })),
    byHourChronological: window.byHourChronological.map((hour) => ({
      ...hour,
      byProject: groupProjectSpending(hour.byProject, locations)
    }))
  }
}

export function getUsageOverviewData(
  index: Database.Database,
  archive: Database.Database,
  locations: UsageProjectLocation[],
  now: Date = new Date()
): Omit<UsageOverview, 'scanComplete' | 'scanSummary'> {
  const activity = getArchivedActivityStats(archive, now)
  const tokens = getTokenStats(archive, now)
  const cost = getCostStats(index, now)
  return {
    activity: {
      ...activity,
      last24h: {
        ...groupActivityWindow(activity.last24h, locations),
        hourlyTrend: activity.last24h.hourlyTrend.map((hour) => ({
          ...hour,
          byProject: groupProjectCounts(hour.byProject, locations)
        }))
      },
      last7d: groupActivityWindow(activity.last7d, locations),
      last30d: groupActivityWindow(activity.last30d, locations)
    },
    tokens: {
      ...tokens,
      last24h: {
        ...tokens.last24h,
        byProject: groupProjectTokens(tokens.last24h.byProject, locations)
      },
      last7d: {
        ...tokens.last7d,
        byProject: groupProjectTokens(tokens.last7d.byProject, locations)
      },
      last30d: {
        ...tokens.last30d,
        byProject: groupProjectTokens(tokens.last30d.byProject, locations)
      }
    },
    cost: cost
      ? {
          ...cost,
          last24h: groupCostWindow(cost.last24h, locations),
          last7d: groupCostWindow(cost.last7d, locations),
          last30d: groupCostWindow(cost.last30d, locations)
        }
      : null,
    models: getModelStats(index, now),
    skills: getSkillStats(index, now)
  }
}

export function getProjectUsageCalendar(
  archive: Database.Database,
  year: number,
  locations: UsageProjectLocation[],
  now: Date = new Date()
): UsageCalendar {
  const calendar = getUsageCalendar(archive, year, now)
  return { ...calendar, byProject: groupProjectMonths(calendar.byProject, locations) }
}

export function getProjectUsageDay(
  archive: Database.Database,
  date: string,
  locations: UsageProjectLocation[],
  now: Date = new Date()
): UsageDayDetails {
  const day = getUsageDay(archive, date, now)
  return { ...day, byProject: groupProjectCounts(day.byProject, locations) }
}

const MAX_LOCATIONS = 50_000
const MAX_PATH_LENGTH = 8192
const LOCATION_STATUSES = ['available', 'missing', 'unavailable', 'needs_access']

export function refreshUsageProjectAvailability(
  locations: UsageProjectLocation[]
): UsageProjectLocation[] {
  return locations.map((entry) => {
    if (!isPathAllowed(entry.path)) return { ...entry, status: 'needs_access' }
    if (allowedStatSync(entry.path)?.isDirectory()) return { ...entry, status: 'available' }
    const { status } = readAllowedDirectory(entry.path, 1)
    return {
      ...entry,
      status: status === 'ok' ? 'available' : status === 'missing' ? 'missing' : 'unavailable'
    }
  })
}

export function readUsageProjectLocations(
  index: Database.Database,
  archive: Database.Database,
  saved: unknown,
  projects: ProjectFolder[]
): UsageProjectLocation[] {
  const archived = archive
    .prepare(
      'SELECT DISTINCT project FROM history_prompts UNION SELECT project FROM history_sessions'
    )
    .all() as { project: string }[]
  const current = index
    .prepare(
      'SELECT DISTINCT cwd AS project FROM sessions_meta UNION SELECT project FROM prompt_history'
    )
    .all() as { project: string }[]
  return refreshUsageProjectAvailability(
    reconcileUsageProjects(
      saved,
      projects,
      [...archived, ...current].map((row) => row.project)
    )
  )
}

function validPath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= MAX_PATH_LENGTH &&
    !value.includes('\0') &&
    /^(?:[a-z]:[\\/]|[\\/])/i.test(value)
  )
}

function savedLocations(saved: unknown): UsageProjectLocation[] {
  if (!Array.isArray(saved)) return []
  const locations: UsageProjectLocation[] = []
  const paths = new Set<string>()
  const identities = new Set<string>()
  for (const entry of saved.slice(0, MAX_LOCATIONS)) {
    if (
      !entry ||
      typeof entry !== 'object' ||
      typeof entry.id !== 'string' ||
      !entry.id ||
      entry.id.length > 128 ||
      !validPath(entry.path) ||
      !['repository', 'folder'].includes(entry.kind) ||
      !LOCATION_STATUSES.includes(entry.status)
    )
      continue
    const key = normalizeProjectPath(entry.path)
    if (paths.has(key) || identities.has(entry.id)) continue
    paths.add(key)
    identities.add(entry.id)
    locations.push({
      id: entry.id,
      path: entry.path,
      kind: entry.kind,
      status: entry.status,
      ...(typeof entry.linkedTo === 'string' ? { linkedTo: entry.linkedTo } : {}),
      ...(entry.inferredOwner === true ? { inferredOwner: true } : {})
    })
  }
  return locations.map((entry) => {
    if (!entry.linkedTo) return entry
    const primary = primaryUsageProject(entry, locations)
    if (primary.id !== entry.id) return { ...entry, linkedTo: primary.id }
    const unlinked = { ...entry }
    delete unlinked.linkedTo
    delete unlinked.inferredOwner
    return unlinked
  })
}

export function reconcileUsageProjects(
  saved: unknown,
  projects: ProjectFolder[],
  paths: string[]
): UsageProjectLocation[] {
  const locations = savedLocations(saved).map((entry) => ({
    ...entry,
    status: 'needs_access' as ProjectFolder['status']
  }))
  const insert = (project: ProjectFolder): void => {
    const existing = locations.find(
      (entry) => normalizeProjectPath(entry.path) === normalizeProjectPath(project.path)
    )
    if (existing) {
      if (existing.kind === 'folder' && project.kind === 'repository' && existing.inferredOwner) {
        delete existing.linkedTo
        delete existing.inferredOwner
      }
      existing.kind = project.kind === 'repository' ? 'repository' : existing.kind
      existing.status = project.status
      existing.path = project.path
    } else if (locations.length < MAX_LOCATIONS) locations.push({ id: randomUUID(), ...project })
  }
  for (const project of projects) if (validPath(project.path)) insert(project)
  for (const path of paths) {
    if (!validPath(path) || usageProjectOwner(path, locations)) continue
    insert({ path, kind: 'folder', status: 'needs_access' })
  }
  for (const entry of locations) {
    if (entry.kind === 'repository' || (entry.linkedTo && !entry.inferredOwner)) continue
    const parent = locations
      .filter(
        (candidate) =>
          candidate.kind === 'repository' &&
          candidate.id !== entry.id &&
          isWithinProjectPath(entry.path, candidate.path)
      )
      .sort((a, b) => b.path.length - a.path.length)[0]
    if (parent) {
      entry.linkedTo = primaryUsageProject(parent, locations).id
      entry.inferredOwner = true
    }
  }
  return locations
}

function requireLocation(locations: UsageProjectLocation[], id: string): UsageProjectLocation {
  const location = locations.find((entry) => entry.id === id)
  if (!location) throw new Error('Project location is no longer available. Refresh and try again.')
  return location
}

export function linkUsageProjects(
  locations: UsageProjectLocation[],
  sourceId: string,
  targetId: string
): UsageProjectLocation[] {
  const source = primaryUsageProject(requireLocation(locations, sourceId), locations)
  const target = primaryUsageProject(requireLocation(locations, targetId), locations)
  if (source.id === target.id)
    throw new Error('These locations already belong to the same project.')
  return locations.map((entry) =>
    primaryUsageProject(entry, locations).id === source.id
      ? { ...entry, linkedTo: target.id }
      : { ...entry }
  )
}

export function unlinkUsageProject(
  locations: UsageProjectLocation[],
  locationId: string
): UsageProjectLocation[] {
  const location = requireLocation(locations, locationId)
  if (location.inferredOwner)
    throw new Error('Working directories belong to their nearest repository.')
  if (!location.linkedTo)
    throw new Error('This is the primary location. Choose a linked location to separate.')
  return locations.map((entry) => {
    if (entry.id !== locationId) return { ...entry }
    const unlinked = { ...entry }
    delete unlinked.linkedTo
    return unlinked
  })
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

// chats only decorates the returned projects; locations, which index.ts persists, never carry it.
export function usageProjectCatalog(
  locations: UsageProjectLocation[],
  chats: Map<string, ClaudeAppChat> = new Map()
): UsageProjectCatalog {
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
    locations,
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
