import { isAbsolute, join, relative, resolve, sep } from 'path'
import type { ProjectFolder, WorktreeLink } from '../../shared/ipc'
import {
  allowedPathLocationSync,
  allowedRealpathSync,
  allowedStatSync,
  getGrantedPaths,
  readAllowedDirectory,
  readAllowedDirectoryEntries,
  readAllowedFile
} from '../permissions'
import type { SkillRoot } from './skills-scanner'
import {
  chooseCanonical,
  parseGitdir,
  readWorktreeIndex,
  worktreeCommonDir,
  type WorktreeIndex
} from './worktrees'

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
  // Worktrees found under a grant that contribute no skills of their own.
  skippedWorktrees: string[]
}

interface WalkScope {
  grant: string
  unavailable: (path: string) => void
}

interface WorktreeCandidate {
  path: string
  directoryPath: string
  commonDir: string
  depth: number
  owner?: string
  scope: WalkScope
  isGrant: boolean
}

export function discoverProjects(
  grants: string[] = getGrantedPaths(),
  previous: ProjectFolder[] = [],
  limits = PROJECT_DISCOVERY_LIMITS
): ProjectDiscovery {
  const projects = new Map<string, ProjectFolder>()
  const roots = new Map<string, SkillRoot>()
  const visited = new Set<string>()
  const gitRepositories = new Set<string>()
  const nestedGitRepositories = new Set<string>()
  const claudeContentOwners = new Set<string>()
  const gitDirs = new Map<string, { commonDir: string; index: WorktreeIndex | null }>()
  // A checkout whose `.git` file points at a git dir that isn't a worktree entry, keyed by that
  // git dir: a submodule or a `--separate-git-dir` repository.
  const mainCheckouts = new Map<string, string>()
  const candidates = new Map<string, WorktreeCandidate>()
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
  const readGitDir = (commonDir: string): WorktreeIndex | null => {
    const key = pathKey(commonDir)
    if (!gitDirs.has(key)) gitDirs.set(key, { commonDir, index: readWorktreeIndex(commonDir) })
    return gitDirs.get(key)!.index
  }
  const readGitFile = (directoryPath: string): string | null => {
    const read = readAllowedFile(join(directoryPath, '.git'), 64 * 1024)
    return read.status === 'ok' && read.contents !== null
      ? parseGitdir(read.contents.toString('utf8'), directoryPath)
      : null
  }

  // `force` walks a worktree that discovery already chose to keep (see below).
  function walk(
    directoryPath: string,
    depth: number,
    owner: string | undefined,
    scope: WalkScope,
    force = false
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
    const gitEntry = directory.entries.find((entry) => entry.name === '.git')
    // A worktree waits until every grant is walked: whether it contributes skills depends on
    // whether its Canonical Checkout turned up anywhere.
    const gitFile = gitEntry?.type === 'file' && !force ? readGitFile(canonical) : null
    const commonDir = gitFile === null ? null : worktreeCommonDir(gitFile)
    if (commonDir !== null) {
      if (!candidates.has(key))
        candidates.set(key, {
          path: canonical,
          directoryPath,
          commonDir,
          depth,
          owner,
          scope,
          isGrant
        })
      return
    }
    if (gitFile !== null) mainCheckouts.set(pathKey(gitFile), canonical)
    visited.add(key)

    const names = new Set(directory.entries.map((entry) => entry.name))
    // A bare repository's git dir is plumbing, never a project, whatever it is named.
    if (
      !names.has('.git') &&
      names.has('HEAD') &&
      names.has('objects') &&
      names.has('refs') &&
      readGitDir(canonical)?.bare === true
    ) {
      if (isGrant) projects.set(key, { path: canonical, kind: 'folder', status: 'available' })
      return
    }
    const claude = names.has('.claude')
      ? readAllowedDirectory(join(directoryPath, '.claude'))
      : { status: 'missing' as const, entries: [] }
    if (claude.status === 'unavailable') unavailable(join(directoryPath, '.claude'))
    const hasSkills =
      claude.entries.includes('skills') &&
      allowedStatSync(join(directoryPath, '.claude', 'skills'))?.isDirectory() === true
    const hasSettings = claude.entries.some(
      (name) => name === 'settings.json' || name === 'settings.local.json'
    )
    // A folder holding a bare `.git` (`git clone --bare <url> app/.git`) only holds worktrees.
    const hasGit =
      gitEntry !== undefined &&
      !(gitEntry.type === 'directory' && readGitDir(join(canonical, '.git'))?.bare === true)
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

  // Exactly one checkout per repository contributes skills. A worktree walked into from a grant
  // never does; a directly granted one stands in while its Canonical Checkout isn't inventoried.
  const canonicals = new Map<string, string | null>()
  const canonicalOf = (commonDir: string, paths: string[] = []): string | null => {
    const key = pathKey(commonDir)
    if (!canonicals.has(key))
      canonicals.set(
        key,
        chooseCanonical(commonDir, readGitDir(commonDir), paths, mainCheckouts.get(key))
      )
    return canonicals.get(key) ?? null
  }
  const groups = new Map<string, WorktreeCandidate[]>()
  for (const candidate of candidates.values())
    groups.set(pathKey(candidate.commonDir), [
      ...(groups.get(pathKey(candidate.commonDir)) ?? []),
      candidate
    ])
  const skippedWorktrees: string[] = []
  const links = new Map<string, WorktreeLink>()
  for (const group of groups.values()) {
    // Never null: a group has at least one candidate to fall back to.
    const canonical = canonicalOf(
      group[0].commonDir,
      group.map((candidate) => candidate.path)
    )!
    const kept = group.find((candidate) => pathKey(candidate.path) === pathKey(canonical))
    if (kept) walk(kept.directoryPath, kept.depth, kept.owner, kept.scope, true)
    const standIn =
      kept === undefined && projects.get(pathKey(canonical))?.kind !== 'repository'
        ? group
            .filter((candidate) => candidate.isGrant)
            .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))[0]
        : undefined
    if (standIn) walk(standIn.directoryPath, standIn.depth, standIn.owner, standIn.scope, true)
    for (const candidate of group) {
      if (candidate !== kept)
        links.set(pathKey(candidate.path), { path: candidate.path, canonical })
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
  // The repository's own list is the stronger evidence, so it overwrites the worktree side.
  for (const { commonDir, index } of gitDirs.values()) {
    if (index === null) continue
    const canonical = canonicalOf(commonDir)
    if (canonical === null) continue
    for (const worktree of index.worktrees)
      if (pathKey(worktree.path) !== pathKey(canonical))
        links.set(pathKey(worktree.path), { path: worktree.path, canonical })
  }

  // A Git repository inside another one with no Claude Code content of its own is a clone,
  // submodule, or vendored dependency, not a project. It still owns its subtree and keeps its
  // skill root (so cached rows reconcile); it just isn't listed. An incomplete walk may not have
  // reached its content, and a direct grant is the user naming it, so neither is hidden.
  if (!incomplete) {
    const grantKeys = new Set(grants.map(pathKey))
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
    worktrees: [...links.values()],
    skippedWorktrees
  }
}
