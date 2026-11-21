import { randomUUID } from 'crypto'
import type { CanonicalCheckout, ProjectFolder, RepoFindings, WorktreeLink } from '../shared/ipc'
import { isWithinProjectPath, normalizeProjectPath } from '../shared/project-path'
import {
  invalidWorktreeTarget,
  nativeWorktreeRoot,
  primaryUsageProject,
  readProjectIdentity,
  usageProjectOwner,
  type ProjectIdentity,
  type ProjectIdentitySnapshot
} from '../shared/project-identity'
import type { UsageProjectLocation } from '../shared/usage-projects'
import { allowedStatSync, isPathAllowed, readAllowedDirectory } from './permissions'

// The one reader and writer of `usageProjects` in preferences.json. See docs/data-model.md "Usage
// project identity": reads never write, and every write persists before memory changes.
export interface ProjectIdentityOwner {
  snapshot(): ProjectIdentitySnapshot
  identity(): ProjectIdentity
  // With live availability; the saved status is only a fallback.
  locations(): UsageProjectLocation[]
  reconcile(): void
  // `goneFolders`: ungranted folders the Scan proved deleted; undefined is no new evidence.
  recordScan(findings: RepoFindings | undefined, goneFolders?: readonly string[]): void
  link(sourceId: string, targetId: string): void
  unlink(locationId: string): void
}

export interface UsageProjectStore {
  read(): unknown
  write(locations: UsageProjectLocation[]): void
}

export function createProjectIdentity(options: {
  store: UsageProjectStore
  claudeCodeFolders: readonly string[]
  // Every working directory the index and the usage archive know.
  sessionPaths: () => string[]
  // The live folder catalog, already limited to folders Megatron may read.
  catalog: () => ProjectFolder[]
}): ProjectIdentityOwner {
  const claudeCodeFolders = [...options.claudeCodeFolders]
  let locations = savedLocations(options.store.read())
  let snapshot: ProjectIdentitySnapshot = { locations, claudeCodeFolders }
  let identity = readProjectIdentity(snapshot)
  // Memory only: a gone folder can come back, and only the next Scan can tell.
  let gone = new Set<string>()
  const reconciled = (from: UsageProjectLocation[]): UsageProjectLocation[] =>
    reconcileUsageProjects(from, options.catalog(), options.sessionPaths(), claudeCodeFolders)
  const commit = (next: UsageProjectLocation[]): void => {
    if (JSON.stringify(next) === JSON.stringify(locations)) return
    options.store.write(next)
    locations = next
    snapshot = { locations, claudeCodeFolders }
    identity = readProjectIdentity(snapshot)
  }
  return {
    snapshot: () => snapshot,
    identity: () => identity,
    locations: () => refreshUsageProjectAvailability(locations, gone),
    reconcile: () => commit(reconciled(locations)),
    recordScan(findings, goneFolders) {
      if (goneFolders) gone = new Set(goneFolders.map(normalizeProjectPath))
      const current = reconciled(locations)
      // Again after the evidence, as every read used to: a folder under a newly linked Worktree
      // only joins that Worktree's repo once ownership is inferred anew.
      commit(
        findings
          ? reconciled(
              applyWorktreeEvidence(current, findings.worktrees, findings.canonicalCheckouts)
            )
          : current
      )
    },
    link: (sourceId, targetId) => commit(linkUsageProjects(locations, sourceId, targetId)),
    unlink: (locationId) => commit(unlinkUsageProject(locations, locationId))
  }
}

const MAX_LOCATIONS = 50_000
const MAX_PATH_LENGTH = 8192
const LOCATION_STATUSES = ['available', 'missing', 'unavailable', 'needs_access']
const REPOSITORY_IDENTITY = /^\d{1,20}:\d{1,20}:-?\d{1,25}$/

function refreshUsageProjectAvailability(
  locations: UsageProjectLocation[],
  gone: ReadonlySet<string>
): UsageProjectLocation[] {
  return locations.map((entry) => {
    if (!isPathAllowed(entry.path))
      return {
        ...entry,
        status: gone.has(normalizeProjectPath(entry.path)) ? 'missing' : 'needs_access'
      }
    if (allowedStatSync(entry.path)?.isDirectory()) return { ...entry, status: 'available' }
    const { status } = readAllowedDirectory(entry.path, 1)
    return {
      ...entry,
      status: status === 'ok' ? 'available' : status === 'missing' ? 'missing' : 'unavailable'
    }
  })
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

// Links stay after the worktree is pruned (its sessions still belong to the repository), and
// newer evidence naming a different repository moves them.
// ponytail: keyed by path, so a reused worktree path moves its old sessions too; key on the
// worktree's git entry if that ever matters.
function applyWorktreeEvidence(
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

function reconcileUsageProjects(
  saved: unknown,
  projects: ProjectFolder[],
  paths: string[],
  claudeCodeFolders: readonly string[]
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
    if (!canonical || !invalidWorktreeTarget(entry, canonical, claudeCodeFolders)) continue
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
      const link = validPath(path) ? nativeWorktreeRoot(path, 'project', claudeCodeFolders) : null
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

function linkUsageProjects(
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

function unlinkUsageProject(
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
