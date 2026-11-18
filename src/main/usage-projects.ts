import type { CanonicalCheckout, ProjectFolder, WorktreeLink } from '../shared/ipc'
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
import {
  isGitDirectoryPath,
  normalizeProjectPath,
  isWithinProjectPath,
  nativeWorktreeRoot
} from '../shared/project-path'
import { randomUUID } from 'crypto'
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

function groupTokenWindow(window: TokenWindow, locations: UsageProjectLocation[]): TokenWindow {
  return {
    ...window,
    byProject: groupProjectTokens(window.byProject, locations),
    trend: window.trend.map((bucket) => ({
      ...bucket,
      byProject: groupProjectTokens(bucket.byProject, locations)
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
      last24h: groupTokenWindow(tokens.last24h, locations),
      last7d: groupTokenWindow(tokens.last7d, locations),
      last30d: groupTokenWindow(tokens.last30d, locations)
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
const REPOSITORY_IDENTITY = /^\d{1,20}:\d{1,20}:-?\d{1,25}$/

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
      ...(entry.inferredOwner === true ? { inferredOwner: true } : {}),
      ...(entry.worktree === true ? { worktree: true as const } : {}),
      ...(entry.worktree === true && entry.worktreeEvidence === 'git'
        ? {
            worktreeEvidence: 'git' as const,
            ...(typeof entry.worktreeRepository === 'string' &&
            REPOSITORY_IDENTITY.test(entry.worktreeRepository)
              ? { worktreeRepository: entry.worktreeRepository }
              : {})
          }
        : {})
    })
  }
  return locations.map((entry) => {
    if (!entry.linkedTo) return entry
    const primary = primaryUsageProject(entry, locations)
    if (primary.id !== entry.id) return entry.worktree ? entry : { ...entry, linkedTo: primary.id }
    const unlinked = { ...entry }
    delete unlinked.linkedTo
    delete unlinked.inferredOwner
    delete unlinked.worktree
    delete unlinked.worktreeEvidence
    delete unlinked.worktreeRepository
    return unlinked
  })
}

function invalidWorktreeTarget(
  entry: UsageProjectLocation,
  canonical: UsageProjectLocation
): boolean {
  if (isGitDirectoryPath(canonical.path)) return true
  if (entry.worktreeEvidence === 'git') return false
  const layout = nativeWorktreeRoot(entry.path, 'config')
  return (
    layout !== null &&
    normalizeProjectPath(layout.canonical) === normalizeProjectPath(canonical.path)
  )
}

export function worktreeLinks(saved: unknown): WorktreeLink[] {
  const locations = savedLocations(saved)
  const byId = new Map(locations.map((entry) => [entry.id, entry]))
  const targetOf = (entry: UsageProjectLocation): UsageProjectLocation | undefined => {
    const canonical = entry.worktree && entry.linkedTo ? byId.get(entry.linkedTo) : undefined
    return canonical && !invalidWorktreeTarget(entry, canonical) ? canonical : undefined
  }
  return locations.flatMap((entry) => {
    let canonical = targetOf(entry)
    if (!canonical) return []
    // A formerly canonical checkout can become a worktree while older, pruned links still name it.
    for (let next = targetOf(canonical); next; next = targetOf(next)) canonical = next
    return [{ path: entry.path, canonical: canonical.path }]
  })
}

// Links stay after the worktree is pruned (its sessions still belong to the repository), and
// newer evidence naming a different repository moves them.
// ponytail: keyed by path, so a reused worktree path moves its old sessions too; key on the
// worktree's git entry if that ever matters.
export function applyWorktreeEvidence(
  locations: UsageProjectLocation[],
  links: readonly WorktreeLink[],
  canonicalCheckouts: readonly CanonicalCheckout[] = [],
  source: 'git' | 'layout' = 'git'
): UsageProjectLocation[] {
  const result = locations.map((entry) => ({ ...entry }))
  const previousById = new Map(locations.map((entry) => [entry.id, entry]))
  const byPath = new Map(result.map((entry) => [normalizeProjectPath(entry.path), entry]))
  const locate = (path: string): UsageProjectLocation | undefined => {
    const existing = byPath.get(normalizeProjectPath(path))
    if (existing || result.length >= MAX_LOCATIONS) return existing
    const created: UsageProjectLocation = {
      id: randomUUID(),
      path,
      kind: 'repository',
      status: 'needs_access'
    }
    result.push(created)
    byPath.set(normalizeProjectPath(path), created)
    return created
  }
  const currentLinks = links.filter(
    (link) =>
      validPath(link.path) &&
      validPath(link.canonical) &&
      normalizeProjectPath(link.path) !== normalizeProjectPath(link.canonical)
  )
  const canonicals = new Map(
    canonicalCheckouts
      .filter((checkout) => validPath(checkout.path))
      .map((checkout) => [normalizeProjectPath(checkout.path), checkout])
  )
  const currentTargets = new Map(
    currentLinks.map((link) => [
      normalizeProjectPath(link.path),
      normalizeProjectPath(link.canonical)
    ])
  )
  const checkoutRoot = (entry: UsageProjectLocation): UsageProjectLocation => {
    const seen = new Set<string>()
    while (entry.worktree && entry.linkedTo && !seen.has(entry.id)) {
      seen.add(entry.id)
      const parent = previousById.get(entry.linkedTo)
      if (!parent) break
      entry = parent
    }
    return entry
  }
  // Snapshot the old graph before promoting anything: historical checkouts must move together,
  // while a manual Usage association beyond the checkout stays separate from skill scoping.
  for (const [key, { repository }] of canonicals) {
    const canonical = byPath.get(key)
    const previous = canonical && previousById.get(canonical.id)
    if (!canonical || !previous?.worktree) continue
    const oldRoot = checkoutRoot(previous)
    delete canonical.worktree
    delete canonical.worktreeEvidence
    delete canonical.worktreeRepository
    delete canonical.linkedTo
    delete canonical.inferredOwner
    canonical.kind = 'repository'
    const oldRootKey = normalizeProjectPath(oldRoot.path)
    // Knowing a path is canonical does not prove its old repository followed it. It may have
    // been reused for a new clone. Use a fresh reverse link when identity was not available.
    const sameRepository =
      repository !== undefined && previous.worktreeRepository !== undefined
        ? repository === previous.worktreeRepository
        : currentTargets.get(oldRootKey) === key
    if (!sameRepository) continue
    if (
      oldRoot.linkedTo &&
      !oldRoot.worktree &&
      !oldRoot.inferredOwner &&
      oldRoot.linkedTo !== canonical.id
    )
      canonical.linkedTo = oldRoot.linkedTo
    for (const entry of result) {
      const entryKey = normalizeProjectPath(entry.path)
      const old = previousById.get(entry.id)
      if (canonicals.has(entryKey) || !old || checkoutRoot(old).id !== oldRoot.id) continue
      entry.linkedTo = canonical.id
      entry.worktree = true
      entry.kind = 'repository'
      delete entry.inferredOwner
      if (repository !== undefined) {
        entry.worktreeEvidence = 'git'
        entry.worktreeRepository = repository
      }
    }
  }
  for (const link of currentLinks) {
    const canonical = locate(link.canonical)
    const worktree = locate(link.path)
    if (!canonical || !worktree) continue
    // A git checkout owns its subtree, like a discovered repository.
    if (canonical.kind === 'folder' && canonical.inferredOwner) {
      delete canonical.linkedTo
      delete canonical.inferredOwner
    }
    canonical.kind = 'repository'
    // A manual link from the checkout into its own worktree said what this link now says.
    if (primaryUsageProject(canonical, result).id === worktree.id) delete canonical.linkedTo
    worktree.kind = 'repository'
    const repository = canonicals.get(normalizeProjectPath(link.canonical))?.repository
    if (repository !== undefined) worktree.worktreeRepository = repository
    else if (worktree.linkedTo !== canonical.id) delete worktree.worktreeRepository
    worktree.linkedTo = canonical.id
    worktree.worktree = true
    if (source === 'git') worktree.worktreeEvidence = 'git'
    delete worktree.inferredOwner
  }
  return result
}

export function reconcileUsageProjects(
  saved: unknown,
  projects: ProjectFolder[],
  paths: string[]
): UsageProjectLocation[] {
  let locations = savedLocations(saved).map((entry) => ({
    ...entry,
    status: 'needs_access' as ProjectFolder['status']
  }))
  const byId = new Map(locations.map((entry) => [entry.id, entry]))
  const formerTargets = new Set<string>()
  for (const entry of locations) {
    if (!entry.worktree || !entry.linkedTo) continue
    const canonical = byId.get(entry.linkedTo)
    if (!canonical || !invalidWorktreeTarget(entry, canonical)) continue
    formerTargets.add(canonical.id)
    delete entry.worktree
    delete entry.worktreeEvidence
    delete entry.worktreeRepository
    delete entry.linkedTo
  }
  if (formerTargets.size > 0) {
    const linkedTargets = new Set(locations.map((entry) => entry.linkedTo))
    const discovered = new Set(projects.map((project) => normalizeProjectPath(project.path)))
    locations = locations.filter(
      (entry) =>
        !formerTargets.has(entry.id) ||
        entry.linkedTo !== undefined ||
        linkedTargets.has(entry.id) ||
        discovered.has(normalizeProjectPath(entry.path)) ||
        paths.some(
          (path) =>
            validPath(path) &&
            isWithinProjectPath(path, entry.path) &&
            usageProjectOwner(path, locations)?.id === entry.id
        )
    )
  }
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
  // Claude Code's own worktree layout is evidence without reading git; a link git already gave
  // for that folder wins.
  const savedWorktree = (path: string): UsageProjectLocation | undefined =>
    locations.find(
      (entry) => entry.worktree && normalizeProjectPath(entry.path) === normalizeProjectPath(path)
    )
  locations = applyWorktreeEvidence(
    locations,
    paths.flatMap((path) => {
      const link = validPath(path) ? nativeWorktreeRoot(path) : null
      if (!link || savedWorktree(link.path)) return []
      // A layout inside a folder git proved is a Worktree belongs to that Worktree's repository;
      // the layout alone can't promote it to a Canonical Checkout.
      const host = savedWorktree(link.canonical)
      return [host ? { ...link, canonical: primaryUsageProject(host, locations).path } : link]
    }),
    [],
    'layout'
  )
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
  // A worktree keeps pointing at its own checkout, which now carries the link.
  return locations.map((entry) =>
    primaryUsageProject(entry, locations).id === source.id && !entry.worktree
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
  if (location.worktree) throw new Error('Worktrees belong to their repository.')
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
