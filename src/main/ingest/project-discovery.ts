import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'path'
import type { ProjectFolder, WorktreeLink } from '../../shared/ipc'
import { isGitDirectoryPath, isWithinProjectPath } from '../../shared/project-path'
import {
  allowedPathLocationSync,
  allowedRealpathSync,
  allowedStatSync,
  getGrantedPaths,
  readAllowedDirectory,
  readAllowedDirectoryEntries
} from '../permissions'
import type { SkillRoot } from './skills-scanner'
import {
  chooseCanonical,
  commonDirOf,
  isNestedGitDirectory,
  presenceOf,
  readCheckoutGitdir,
  readWorktreeIndex,
  sameGitPath,
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
  canonicalCheckouts: string[]
  // Worktrees found under a grant that contribute no skills of their own.
  skippedWorktrees: string[]
  gitDirHolders: string[]
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
  limits = PROJECT_DISCOVERY_LIMITS,
  savedLinks: readonly WorktreeLink[] = []
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
  const orphans = new Map<string, WorktreeCandidate>()
  const containers = new Map<string, { path: string; commonDir: string }>()
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
  const readGitDir = (commonDir: string): WorktreeIndex | null => {
    const key = pathKey(commonDir)
    if (!gitDirs.has(key)) gitDirs.set(key, { commonDir, index: readWorktreeIndex(commonDir) })
    return gitDirs.get(key)!.index
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
    const pointer = gitEntry?.type === 'file' && !force ? readCheckoutGitdir(canonical) : null
    const gitFile = pointer === null ? null : (allowedRealpathSync(pointer) ?? pointer)
    const commonDir = gitFile === null ? null : commonDirOf(gitFile)
    if (commonDir === null && gitFile !== null && presenceOf(gitFile) === 'missing') {
      // Its admin dir is gone; a repository that still lists it claims it after the walk.
      if (!orphans.has(key) || isGrant)
        orphans.set(key, {
          path: canonical,
          directoryPath,
          commonDir: '',
          depth,
          owner,
          scope,
          isGrant
        })
      return
    }
    if (commonDir !== null) {
      // Parent grants walk first; the worktree's own grant, met later, is what lets it stand in.
      if (!candidates.has(key) || isGrant)
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
    const gitDir = gitFile ?? (gitEntry?.type === 'directory' ? join(canonical, '.git') : null)
    const index = gitDir === null ? null : readGitDir(gitDir)
    const bareContainer = gitFile !== null && index?.bare === true
    if (bareContainer) containers.set(key, { path: canonical, commonDir: gitFile })
    else if (gitFile !== null) mainCheckouts.set(pathKey(gitFile), canonical)

    const redirected =
      gitEntry?.type === 'directory' &&
      index?.worktree != null &&
      presenceOf(index.worktree) === 'present' &&
      !sameGitPath(index.worktree, canonical)
    if (redirected) gitDirHolders.add(canonical)
    visited.add(key)

    const names = new Set(directory.entries.map((entry) => entry.name))
    // A standalone git dir is plumbing, even when its checkout lives elsewhere.
    if (
      !names.has('.git') &&
      names.has('HEAD') &&
      names.has('objects') &&
      names.has('refs') &&
      readGitDir(canonical) !== null
    ) {
      if (isGrant) projects.set(key, { path: canonical, kind: 'folder', status: 'available' })
      return
    }
    const claude =
      !bareContainer && !redirected && names.has('.claude')
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
    const hasGit = gitEntry !== undefined && index?.bare !== true && !redirected
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

  // Candidates can be the only discoverable path into a separate git dir.
  for (const candidate of candidates.values()) readGitDir(candidate.commonDir)
  // A checkout whose admin dir is gone belongs to the repository that still lists it (a main
  // checkout renamed without `git worktree repair`); with none, it's a checkout of its own.
  for (const [key, orphan] of orphans) {
    const lister = [...gitDirs.values()].find(({ index }) =>
      index?.worktrees.some((worktree) => pathKey(worktree.path) === key)
    )
    if (lister) candidates.set(key, { ...orphan, commonDir: lister.commonDir })
    else walk(orphan.directoryPath, orphan.depth, orphan.owner, orphan.scope, true)
  }
  for (const candidate of candidates.values()) readGitDir(candidate.commonDir)
  const grantKeys = new Set(grants.map(pathKey))
  const redirects: string[] = []
  for (const { commonDir, index } of gitDirs.values()) {
    if (index?.bare || isNestedGitDirectory(commonDir)) continue
    const main = mainCheckouts.get(pathKey(commonDir))
    const checkout = main ?? index?.worktree
    if (!checkout || (!main && presenceOf(checkout) !== 'present')) continue
    const location = allowedRealpathSync(checkout) ?? checkout
    // Only a `.git` dir makes its folder a checkout; a standalone git dir (a dotfiles repo with
    // core.worktree=$HOME) is reached through an alias, so git itself never treats that a checkout.
    if (basename(commonDir) !== '.git' || sameGitPath(dirname(commonDir), location)) continue
    gitDirHolders.add(dirname(commonDir))
    if (!main && visited.has(pathKey(location)) && !gitRepositories.has(pathKey(location)))
      redirects.push(location)
  }
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
  for (const key of excluded) projects.delete(key)
  for (const [key, root] of roots) {
    if (root.projectRoot && excluded.has(pathKey(root.projectRoot))) roots.delete(key)
  }

  // Exactly one checkout per repository contributes skills. A worktree walked into from a grant
  // never does; a directly granted one stands in while its Canonical Checkout isn't inventoried.
  const canonicals = new Map<string, string | null>()
  const saved = new Map(savedLinks.map((link) => [pathKey(link.path), link.canonical]))
  const containerPaths = new Map<string, string[]>()
  for (const { path, commonDir } of containers.values()) {
    const key = pathKey(commonDir)
    const paths = containerPaths.get(key) ?? []
    paths.push(path)
    containerPaths.set(key, paths)
  }
  const canonicalOf = (commonDir: string, paths: string[] = []): string | null => {
    const key = pathKey(commonDir)
    if (!canonicals.has(key)) {
      const index = readGitDir(commonDir)
      const listed = index?.worktrees.map((entry) => entry.path) ?? []
      const live = new Set(
        index?.worktrees.filter((entry) => !entry.missing).map((entry) => pathKey(entry.path)) ??
          paths.map(pathKey)
      )
      const previous = [...listed, ...paths, ...(containerPaths.get(key) ?? [])]
        .map((path) => saved.get(pathKey(path)))
        .find((path) => path !== undefined && live.has(pathKey(path)))
      const choice = chooseCanonical(commonDir, index, paths, mainCheckouts.get(key), previous)
      const checkout = choice === null ? null : (allowedRealpathSync(choice) ?? choice)
      if (
        checkout === null ||
        isGitDirectoryPath(checkout) ||
        isWithinProjectPath(checkout, commonDir)
      ) {
        canonicals.set(key, null)
      } else {
        const directory = readAllowedDirectoryEntries(checkout)
        const checkoutKey = pathKey(checkout)
        const listedLive = index?.worktrees.some(
          (worktree) => !worktree.missing && pathKey(worktree.path) === checkoutKey
        )
        const redirect = index?.worktree
        const hasGit = directory.entries.some((entry) => entry.name === '.git')
        const valid =
          directory.status === 'unavailable' ||
          (directory.status === 'missing' && listedLive) ||
          (directory.status === 'ok' &&
            (hasGit ||
              (redirect && pathKey(allowedRealpathSync(redirect) ?? redirect) === checkoutKey)))
        canonicals.set(key, valid ? checkout : null)
      }
    }
    return canonicals.get(key) ?? null
  }
  const groups = new Map<string, WorktreeCandidate[]>()
  for (const candidate of candidates.values())
    groups.set(pathKey(candidate.commonDir), [
      ...(groups.get(pathKey(candidate.commonDir)) ?? []),
      candidate
    ])
  const skippedWorktrees = [...containers.values()].map(({ path }) => path)
  const links = new Map<string, WorktreeLink>()
  for (const group of groups.values()) {
    const canonical = canonicalOf(
      group[0].commonDir,
      group.map((candidate) => candidate.path)
    )
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
      if (canonical !== null && candidate !== kept)
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
  for (const { path, commonDir } of containers.values()) {
    const canonical = canonicalOf(commonDir)
    if (canonical !== null) links.set(pathKey(path), { path, canonical })
  }
  // The checkout's own pointer wins when both sides can be read.
  for (const { commonDir, index } of gitDirs.values()) {
    if (index === null || isNestedGitDirectory(commonDir)) continue
    const canonical = canonicalOf(commonDir)
    if (canonical === null) continue
    for (const worktree of index.worktrees)
      if (pathKey(worktree.path) !== pathKey(canonical) && !links.has(pathKey(worktree.path)))
        links.set(pathKey(worktree.path), { path: worktree.path, canonical })
  }

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
      excluded.has(key) ||
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
    canonicalCheckouts: [...gitDirs.values()].flatMap(({ commonDir, index }) => {
      const canonical = canonicals.get(pathKey(commonDir))
      return index?.complete && canonical && projects.get(pathKey(canonical))?.kind === 'repository'
        ? [canonical]
        : []
    }),
    skippedWorktrees,
    gitDirHolders: [...gitDirHolders]
  }
}
