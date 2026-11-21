import { isAbsolute, join, relative, resolve, sep } from 'path'
import type { CanonicalCheckout, ProjectFolder, WorktreeLink } from '../../shared/ipc'
import { isHiddenProject, isWithinProjectPath } from '../../shared/project-path'
import {
  allowedPathLocationSync,
  allowedRealpathSync,
  allowedStatSync,
  getGrantedPaths,
  readAllowedDirectory,
  readAllowedDirectoryEntries
} from '../permissions'
import type { SkillRoot } from './skills-scanner'
import { createGitRepos, type GitRepos } from './git-repos'

const SKIP_DIRECTORIES = new Set(
  [
    'node_modules',
    '.git',
    'dist',
    'build',
    'out',
    'coverage',
    'vendor',
    'target',
    '.next',
    // A skill's own reference/example files must never read as a nested package.
    '.claude',
    '.tmp',
    '.temp',
    '__MACOSX'
  ].map((name) => (process.platform === 'win32' ? name.toLowerCase() : name))
)
export const PROJECT_DISCOVERY_LIMITS = { maxDepth: 64, maxDirectories: 50_000 }

export function sanitizeProjectFolders(value: unknown): ProjectFolder[] {
  if (!Array.isArray(value)) return []
  return value
    .slice(0, PROJECT_DISCOVERY_LIMITS.maxDirectories)
    .filter(
      (entry): entry is ProjectFolder =>
        entry !== null &&
        typeof entry === 'object' &&
        typeof entry.path === 'string' &&
        isAbsolute(entry.path) &&
        ['folder', 'repository'].includes(entry.kind) &&
        ['available', 'unavailable', 'missing', 'needs_access'].includes(entry.status)
    )
}

function pathKey(path: string): string {
  const absolute = resolve(path)
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute
}

function shouldSkipDirectory(name: string): boolean {
  return SKIP_DIRECTORIES.has(process.platform === 'win32' ? name.toLowerCase() : name)
}

function isDiscoverableFromGrant(projectPath: string, grant: string): boolean {
  const subpath = relative(pathKey(grant), pathKey(projectPath))
  if (subpath === '') return true
  if (isAbsolute(subpath) || subpath === '..' || subpath.startsWith(`..${sep}`)) return false
  return !subpath.split(sep).some(shouldSkipDirectory)
}

export function isProjectDiscoveryExcluded(
  projectPath: string,
  grants: string[] = getGrantedPaths()
): boolean {
  const key = pathKey(projectPath)
  const covered = grants.some((grant) => {
    const grantKey = pathKey(grant)
    return key === grantKey || key.startsWith(grantKey.endsWith(sep) ? grantKey : grantKey + sep)
  })
  return covered && !grants.some((grant) => isDiscoverableFromGrant(projectPath, grant))
}

export function createMissingProjectCheck(
  grants: string[] = getGrantedPaths()
): (path: string) => boolean {
  const locations = grants.map((grant) => ({ grant, location: allowedPathLocationSync(grant) }))
  const explicit = new Set(locations.map(({ grant, location }) => pathKey(location ?? grant)))
  // An offline or unreadable grant is not evidence that its children were deleted.
  const readable = locations.flatMap(({ grant, location }) =>
    location !== null && readAllowedDirectory(grant).status === 'ok' ? [location] : []
  )
  return (path) => {
    const location = allowedPathLocationSync(path)
    return (
      location !== null &&
      !explicit.has(pathKey(location)) &&
      readable.some((grant) => isDiscoverableFromGrant(location, grant)) &&
      readAllowedDirectory(path).status === 'missing'
    )
  }
}

export interface ProjectDiscovery {
  projects: ProjectFolder[]
  skillRoots: SkillRoot[]
  incomplete: boolean
  // Every worktree link seen this pass, from either side; see CONTEXT.md "Worktree".
  worktrees: WorktreeLink[]
  canonicalCheckouts: CanonicalCheckout[]
  // Worktrees found under a grant that contribute no skills of their own.
  skippedWorktrees: string[]
  gitDirHolders: string[]
}

interface WalkScope {
  grant: string
  unavailable: (path: string) => void
}

// Where the walk met a folder it held back, so it can enter it later.
interface HeldBack {
  path: string
  directoryPath: string
  depth: number
  owner?: string
  scope: WalkScope
  isGrant: boolean
}

// `repos` is this Scan's Git Repos; it answers every git question the walk asks.
export function discoverProjects(
  grants: string[] = getGrantedPaths(),
  previous: ProjectFolder[] = [],
  limits = PROJECT_DISCOVERY_LIMITS,
  repos: GitRepos = createGitRepos({ locations: [], claudeCodeFolders: [] }),
  hidden: readonly string[] = []
): ProjectDiscovery {
  const projects = new Map<string, ProjectFolder>()
  const roots = new Map<string, SkillRoot>()
  const visited = new Set<string>()
  const gitRepositories = new Set<string>()
  const nestedGitRepositories = new Set<string>()
  const claudeContentOwners = new Set<string>()
  // A worktree waits until every grant is walked: whether it contributes skills depends on
  // whether its Canonical Checkout turned up anywhere. An orphan waits for its repository.
  const worktrees = new Map<string, HeldBack>()
  const orphans = new Map<string, HeldBack>()
  const containers = new Map<string, string>()
  const gitDirHolders = new Set<string>()
  let incomplete = false
  const uncertainPaths: string[] = []
  const isDiscoveryUncertain = (path: string): boolean =>
    uncertainPaths.some((uncertain) => {
      const key = pathKey(path)
      const uncertainKey = pathKey(uncertain)
      return (
        key === uncertainKey ||
        key.startsWith(uncertainKey + sep) ||
        uncertainKey.startsWith(key + sep)
      )
    })
  const isMissingProject = createMissingProjectCheck(grants)
  const addRoot = (dir: string, projectRoot: string): void => {
    if (!roots.has(pathKey(dir)))
      roots.set(pathKey(dir), { dir, sourceType: 'project', projectRoot })
  }
  // `asCheckout` enters a held-back folder that discovery chose to keep (see below).
  function walk(
    directoryPath: string,
    depth: number,
    owner: string | undefined,
    scope: WalkScope,
    asCheckout = false
  ): void {
    const { grant, unavailable } = scope
    if (depth > limits.maxDepth || visited.size >= limits.maxDirectories) {
      unavailable(directoryPath)
      return
    }
    const directory = readAllowedDirectoryEntries(directoryPath)
    const isGrant = pathKey(directoryPath) === pathKey(grant)
    if (directory.status !== 'ok') {
      if (directory.status === 'unavailable') unavailable(directoryPath)
      if (isGrant)
        projects.set(pathKey(grant), {
          path: grant,
          kind: 'folder',
          status: directory.status === 'missing' ? 'missing' : 'unavailable'
        })
      return
    }
    const canonical = allowedRealpathSync(directoryPath)
    if (canonical === null) {
      unavailable(directoryPath)
      return
    }
    const key = pathKey(canonical)
    if (visited.has(key)) {
      if (isGrant && !projects.has(key))
        projects.set(key, { path: canonical, kind: 'folder', status: 'available' })
      return
    }
    const kind = repos.meet({ path: canonical, entries: directory.entries, asCheckout })
    if (kind === 'worktree' || kind === 'orphan') {
      const held = kind === 'worktree' ? worktrees : orphans
      // Parent grants walk first; the worktree's own grant, met later, is what lets it stand in.
      if (!held.has(key) || isGrant)
        held.set(key, { path: canonical, directoryPath, depth, owner, scope, isGrant })
      return
    }
    if (kind === 'bare-container') containers.set(key, canonical)
    if (kind === 'git-dir-holder') gitDirHolders.add(canonical)
    visited.add(key)
    if (kind === 'git-dir') {
      if (isGrant) projects.set(key, { path: canonical, kind: 'folder', status: 'available' })
      return
    }

    const names = new Set(directory.entries.map((entry) => entry.name))
    const claude =
      kind !== 'bare-container' && kind !== 'git-dir-holder' && names.has('.claude')
        ? readAllowedDirectory(join(directoryPath, '.claude'))
        : { status: 'missing' as const, entries: [] }
    if (claude.status === 'unavailable') unavailable(join(directoryPath, '.claude'))
    const hasSkills =
      claude.entries.includes('skills') &&
      allowedStatSync(join(directoryPath, '.claude', 'skills'))?.isDirectory() === true
    const hasSettings = claude.entries.some(
      (name) => name === 'settings.json' || name === 'settings.local.json'
    )
    const hasGit = kind === 'checkout'
    const isRepository = hasGit || (owner === undefined && (hasSkills || hasSettings))
    const owningProject = isRepository ? canonical : owner
    if (hasGit) gitRepositories.add(key)
    if (hasGit && owner !== undefined && gitRepositories.has(pathKey(owner)))
      nestedGitRepositories.add(key)
    if ((hasSkills || hasSettings) && owningProject !== undefined)
      claudeContentOwners.add(pathKey(owningProject))
    if (isRepository || isGrant)
      projects.set(key, {
        path: canonical,
        kind: isRepository ? 'repository' : 'folder',
        status: claude.status === 'unavailable' ? 'unavailable' : 'available'
      })
    if (isRepository) addRoot(join(directoryPath, '.claude', 'skills'), canonical)
    if (hasSkills) addRoot(join(directoryPath, '.claude', 'skills'), owningProject ?? grant)

    for (const { name, type } of directory.entries) {
      if (shouldSkipDirectory(name)) continue
      if (type === 'file') continue
      const child = join(directoryPath, name)
      if (type === 'directory') {
        walk(child, depth + 1, owningProject, scope)
        continue
      }
      const stats = allowedStatSync(child)
      if (stats === null) {
        unavailable(child)
        continue
      }
      if (stats.isDirectory()) walk(child, depth + 1, owningProject, scope)
    }
  }

  // Discover ancestors first so an overlapping package grant cannot replace its
  // repository owner merely because the user selected that folder earlier.
  for (const grant of [...grants].sort(
    (first, second) => pathKey(first).length - pathKey(second).length
  )) {
    let grantIncomplete = false
    const unavailable = (path: string): void => {
      incomplete = true
      grantIncomplete = true
      uncertainPaths.push(path)
    }
    addRoot(join(grant, '.claude', 'skills'), grant)
    walk(grant, 0, undefined, { grant, unavailable })
    if (grantIncomplete) {
      const root = roots.get(pathKey(join(grant, '.claude', 'skills')))
      if (root) root.discoveryIncomplete = true
    }
  }

  // A checkout whose admin dir is gone belongs to the repository that still lists it (a main
  // checkout renamed without `git worktree repair`); with none, it's a checkout of its own.
  for (const [key, orphan] of orphans) {
    if (repos.claimOrphan(orphan.path)) worktrees.set(key, orphan)
    else walk(orphan.directoryPath, orphan.depth, orphan.owner, orphan.scope, true)
  }
  const resolved = repos.resolve()
  const grantKeys = new Set(grants.map(pathKey))
  for (const holder of resolved.gitDirHolders) gitDirHolders.add(holder)
  const redirects = resolved.redirects.filter(
    (checkout) => visited.has(pathKey(checkout)) && !gitRepositories.has(pathKey(checkout))
  )
  // A redirected checkout can sort after its packages or before the git dir that names it.
  for (const checkout of redirects.sort((a, b) => a.length - b.length)) {
    const key = pathKey(checkout)
    gitRepositories.add(key)
    projects.set(key, {
      path: checkout,
      kind: 'repository',
      status: projects.get(key)?.status ?? 'available'
    })
    for (const root of roots.values()) {
      if (!root.projectRoot || !isWithinProjectPath(root.dir, checkout)) continue
      if (
        gitRepositories.has(pathKey(root.projectRoot)) &&
        isWithinProjectPath(root.projectRoot, checkout)
      )
        continue
      root.projectRoot = checkout
      claudeContentOwners.add(key)
    }
    for (const [projectKey, project] of projects) {
      if (projectKey === key || !isWithinProjectPath(project.path, checkout)) continue
      if (gitRepositories.has(projectKey)) nestedGitRepositories.add(projectKey)
      else if (grantKeys.has(projectKey)) project.kind = 'folder'
      else projects.delete(projectKey)
    }
    addRoot(join(checkout, '.claude', 'skills'), checkout)
  }
  const excluded = new Set([...containers.keys(), ...[...gitDirHolders].map(pathKey)])
  // A folder the user hid (hidden-projects.ts) goes with everything inside it. The walk still
  // enters it, so ownership of the folders around it comes out the same as when it is shown.
  const isExcluded = (path: string): boolean =>
    excluded.has(pathKey(path)) || isHiddenProject(path, hidden)
  for (const [key, project] of projects) if (isExcluded(project.path)) projects.delete(key)
  for (const [key, root] of roots) {
    if (root.projectRoot && isExcluded(root.projectRoot)) roots.delete(key)
  }

  // Exactly one checkout per repository contributes skills. A worktree walked into from a grant
  // never does; a directly granted one stands in while its Canonical Checkout isn't inventoried.
  const skippedWorktrees = [...containers.values()]
  for (const { canonical, worktrees: paths } of resolved.repos) {
    const group = paths.map((path) => worktrees.get(pathKey(path))!)
    const kept =
      canonical === null
        ? undefined
        : group.find((candidate) => pathKey(candidate.path) === pathKey(canonical))
    if (kept) walk(kept.directoryPath, kept.depth, kept.owner, kept.scope, true)
    const standIn =
      kept === undefined &&
      (canonical === null || projects.get(pathKey(canonical))?.kind !== 'repository')
        ? group
            .filter((candidate) => candidate.isGrant)
            .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))[0]
        : undefined
    if (standIn) walk(standIn.directoryPath, standIn.depth, standIn.owner, standIn.scope, true)
    for (const candidate of group) {
      if (candidate === kept || candidate === standIn) continue
      skippedWorktrees.push(candidate.path)
      if (!candidate.isGrant) continue
      roots.delete(pathKey(join(candidate.scope.grant, '.claude', 'skills')))
      projects.set(pathKey(candidate.path), {
        path: candidate.path,
        kind: 'folder',
        status: 'available'
      })
    }
  }
  // After the walks above: the folders they entered can prove more.
  const findings = repos.findings()

  // A Git repository inside another one with no Claude Code content of its own is a clone,
  // submodule, or vendored dependency, not a project. It still owns its subtree and keeps its
  // skill root (so cached rows reconcile); it just isn't listed. An incomplete walk may not have
  // reached its content, and a direct grant is the user naming it, so neither is hidden.
  if (!incomplete) {
    for (const key of nestedGitRepositories)
      if (!claudeContentOwners.has(key) && !grantKeys.has(key)) projects.delete(key)
  }

  // Cached discovery is never a permission grant. A revoked ancestor may still be
  // covered by another explicit grant; otherwise discard its catalog entry.
  for (const entry of sanitizeProjectFolders(previous)) {
    const key = pathKey(entry.path)
    const covered = grants.some((grant) => isDiscoverableFromGrant(entry.path, grant))
    if (
      !covered ||
      isExcluded(entry.path) ||
      isMissingProject(entry.path) ||
      (entry.kind === 'folder' && !grants.some((grant) => key === pathKey(grant)))
    )
      continue
    const current = projects.get(key)
    if (current) {
      if (current.status !== 'available' && entry.kind === 'repository') current.kind = 'repository'
      continue
    }
    const directory = readAllowedDirectory(entry.path)
    const uncertain = isDiscoveryUncertain(entry.path)
    if (!uncertain && directory.status === 'ok') continue
    const status =
      directory.status === 'missing'
        ? 'missing'
        : directory.status === 'unavailable' || uncertain
          ? 'unavailable'
          : 'available'
    projects.set(key, { path: entry.path, kind: entry.kind, status })
    if (entry.kind === 'repository') addRoot(join(entry.path, '.claude', 'skills'), entry.path)
  }
  return {
    projects: [...projects.values()],
    skillRoots: [...roots.values()],
    incomplete,
    worktrees: findings.worktrees,
    // Only a checkout listed as a repository; a stand-in or hidden folder proves nothing.
    canonicalCheckouts: findings.canonicalCheckouts.filter(
      (checkout) => projects.get(pathKey(checkout.path))?.kind === 'repository'
    ),
    skippedWorktrees,
    gitDirHolders: [...gitDirHolders]
  }
}
