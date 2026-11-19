import { basename, dirname, join } from 'path'
import type { RepoFindings, WorktreeLink } from '../../shared/ipc'
import {
  isGitDirectoryPath,
  isWithinProjectPath,
  normalizeProjectPath
} from '../../shared/project-path'
import {
  readProjectIdentity,
  type ProjectIdentity,
  type ProjectIdentitySnapshot
} from '../../shared/project-identity'
import {
  allowedDirectoryIdentitySync,
  allowedPathLocationSync,
  allowedRealpathSync,
  allowedStatSync,
  isPathAllowed,
  readAllowedDirectoryEntries,
  readAllowedFile,
  type AllowedDirectoryEntry
} from '../permissions'
import { gitBoolean, parseGitConfig, parseGitdir, resolveGitPath } from './git-config'
import { readReftableHead } from './reftable'

// What a folder met during the walk is, as far as git says:
// - checkout: a repository's own working folder (a `.git` dir, or a `.git` file naming a git dir
//   that isn't a worktree entry: a submodule or a `--separate-git-dir` repository)
// - worktree: a linked Worktree, held back until resolve() names its Canonical Checkout
// - orphan: a `.git` file whose admin dir is gone, held back for claimOrphan()
// - bare-container: holds a `.git` file naming a bare repository; it only holds Worktrees
// - git-dir-holder: holds a `.git` dir whose core.worktree names a checkout elsewhere
// - git-dir: a standalone git dir (HEAD, objects, refs), plumbing even when its checkout is elsewhere
// - plain: anything else, including a folder holding a bare `.git` dir
export type FolderKind =
  'checkout' | 'worktree' | 'orphan' | 'bare-container' | 'git-dir-holder' | 'git-dir' | 'plain'

export interface MetFolder {
  // The folder's real path.
  path: string
  // Its entries, as the walk already read them.
  entries: readonly AllowedDirectoryEntry[]
  // A held-back worktree or orphan the walk now enters as a checkout: its `.git` file isn't followed.
  asCheckout?: boolean
}

export interface Repo {
  // Null when no checkout can be proven: its Worktrees then stay independent.
  canonical: string | null
  // The Worktrees met (or claimed), in meeting order.
  worktrees: string[]
}

export interface ResolvedRepos {
  repos: Repo[]
  // Checkouts a `.git` dir elsewhere names as its core.worktree: repositories without a `.git`.
  redirects: string[]
  // Folders holding a `.git` dir whose checkout is elsewhere.
  gitDirHolders: string[]
}

// One per Scan. In order: meet() every folder the walk enters, claimOrphan() each held-back
// orphan, resolve(), meet() whatever the walk enters after that, then findings().
// isPrunedWorktree() answers from the same reads, with this Scan's links once findings() ran.
export interface GitRepos {
  meet(folder: MetFolder): FolderKind
  // True when a repository read so far lists the orphan, which then joins that Repo's Worktrees.
  claimOrphan(path: string): boolean
  resolve(): ResolvedRepos
  // Every link seen this Scan, from either side, and the Canonical Checkout of each fully read Repo.
  findings(): RepoFindings
  isPrunedWorktree(path: string, isMissingProject: (path: string) => boolean): boolean
}

interface WorktreeIndex {
  // False when some entry couldn't be read, so absence from `worktrees` proves nothing.
  complete: boolean
  bare: boolean
  head: string | null
  worktree: string | null
  worktrees: { path: string; branch: string | null; missing: boolean }[]
}

const MAX_GIT_METADATA_BYTES = 64 * 1024
const WORKTREE_GITDIR = /^(.+)[\\/]worktrees[\\/][^\\/]+[\\/]?$/

// The one key for every git path this module caches or compares.
const key = normalizeProjectPath

function cached<T>(cache: Map<string, T>, path: string, read: () => T): T {
  const k = key(path)
  if (!cache.has(k)) cache.set(k, read())
  return cache.get(k) as T
}

function isNestedGitDirectory(gitdir: string): boolean {
  return isGitDirectoryPath(dirname(key(gitdir)))
}

// Gone only when an existing granted folder above it shows it gone: a path outside every grant,
// or a whole grant that is missing (an unmounted volume), proves nothing either way.
function presenceOf(path: string): 'present' | 'missing' | 'unknown' {
  if (!isPathAllowed(path)) return 'unknown'
  if (allowedStatSync(path) !== null) return 'present'
  return readAllowedDirectoryEntries(path, 1).status === 'missing' &&
    allowedPathLocationSync(path) !== null
    ? 'missing'
    : 'unknown'
}

function readText(path: string): { status: 'ok' | 'missing' | 'unavailable'; text: string } {
  const read = readAllowedFile(path, MAX_GIT_METADATA_BYTES)
  return read.status === 'ok' && read.contents !== null
    ? { status: 'ok', text: read.contents.toString('utf8') }
    : { status: read.status === 'missing' ? 'missing' : 'unavailable', text: '' }
}

function readCheckoutGitdir(checkout: string): string | null {
  const { text } = readText(join(checkout, '.git'))
  return text.startsWith('gitdir:') ? parseGitdir(text, checkout) : null
}

function readCommonDir(gitdir: string): string | null {
  const read = readText(join(gitdir, 'commondir'))
  // Without a readable admin dir, its path is the evidence Git leaves available to us.
  const commonDir =
    read.status === 'ok'
      ? parseGitdir(read.text, gitdir)
      : presenceOf(gitdir) === 'unknown'
        ? (WORKTREE_GITDIR.exec(gitdir)?.[1] ?? null)
        : null
  if (commonDir === null) return null
  const location = allowedRealpathSync(commonDir) ?? commonDir
  return isNestedGitDirectory(location) ? null : location
}

function sameGitPath(first: string, second: string): boolean {
  if (key(first) === key(second)) return true
  const real = allowedRealpathSync(first)
  const other = allowedRealpathSync(second)
  if (real !== null && other !== null && key(real) === key(other)) return true
  // realpath keeps the typed letter case, and macOS folders are case-insensitive by default.
  // Windows already compares lowercased, and its 64-bit file IDs don't fit a number's precision.
  if (process.platform === 'win32') return false
  const stats = allowedStatSync(first)
  const others = allowedStatSync(second)
  return (
    stats !== null &&
    others !== null &&
    stats.ino !== 0 &&
    stats.dev === others.dev &&
    stats.ino === others.ino
  )
}

function headBranch(text: string): string | null {
  return /^ref:\s*refs\/heads\/(.+?)\s*$/m.exec(text)?.[1] ?? null
}

// Null when the git dir can't be listed (ungranted, gone, or a worktree's `.git` file): nothing
// is known about it, not even whether it is bare.
function readWorktreeIndex(
  commonDir: string,
  readPointer: (checkout: string) => string | null
): WorktreeIndex | null {
  if (readAllowedDirectoryEntries(commonDir).status !== 'ok') return null
  const config = readText(join(commonDir, 'config'))
  const base = parseGitConfig(config.text)
  const overlay = gitBoolean(base.get('extensions.worktreeconfig'))
    ? readText(join(commonDir, 'config.worktree'))
    : undefined
  const settings = new Map([...base, ...parseGitConfig(overlay?.text ?? '')])
  const worktree = settings.get('core.worktree')
  const refStorage = settings.get('extensions.refstorage')
  const readBranch = (gitdir: string): string | null =>
    typeof refStorage === 'string' && refStorage.toLowerCase() === 'reftable'
      ? readReftableHead(gitdir)
      : headBranch(readText(join(gitdir, 'HEAD')).text)
  const index: WorktreeIndex = {
    complete: config.status !== 'unavailable' && overlay?.status !== 'unavailable',
    bare: gitBoolean(settings.get('core.bare')),
    head: readBranch(commonDir),
    worktree:
      typeof worktree === 'string' ? resolveGitPath(worktree, commonDir, process.platform) : null,
    worktrees: []
  }
  const directory = readAllowedDirectoryEntries(join(commonDir, 'worktrees'))
  if (directory.status === 'unavailable') index.complete = false
  for (const { name } of directory.entries) {
    const entry = join(commonDir, 'worktrees', name)
    const gitdir = readText(join(entry, 'gitdir'))
    // git itself prunes an entry whose gitdir file is gone, so it names no live worktree.
    if (gitdir.status === 'missing') continue
    const pointer = parseGitdir(gitdir.text, entry)
    if (gitdir.status === 'unavailable' || pointer === null) {
      index.complete = false
      continue
    }
    if (key(basename(pointer)) !== '.git') continue
    const path = dirname(pointer)
    const reverse = readPointer(path)
    // The checkout's own pointer wins only while the admin dir it names exists: a main checkout
    // renamed without `git worktree repair` leaves this list as the only live link.
    if (reverse !== null && !sameGitPath(reverse, entry) && presenceOf(reverse) !== 'missing')
      continue
    if (reverse === null && allowedStatSync(pointer)?.isDirectory()) continue
    const missing =
      presenceOf(path) === 'missing' && readText(join(entry, 'locked')).status === 'missing'
    index.worktrees.push({
      path: allowedRealpathSync(path) ?? path,
      branch: readBranch(entry),
      missing
    })
  }
  return index
}

// `main` is a checkout whose own `.git` file points at this git dir (`--separate-git-dir`).
function chooseCanonical(
  commonDir: string,
  index: WorktreeIndex | null,
  candidates: readonly string[],
  main?: string,
  saved?: string
): string | null {
  if (!index?.bare) {
    const checkout = main ?? index?.worktree
    if (checkout) return checkout
    if (basename(commonDir) === '.git') return dirname(commonDir)
    if (index) return null
  }
  const listed = index?.worktrees.filter((worktree) => !worktree.missing) ?? []
  const pool =
    index?.complete || listed.length > 0
      ? listed
      : candidates.map((path) => ({ path, branch: null }))
  pool.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return (
    (
      pool.find((worktree) => index?.head && worktree.branch === index.head) ??
      pool.find((worktree) => saved !== undefined && sameGitPath(worktree.path, saved)) ??
      pool[0]
    )?.path ?? null
  )
}

export function createGitRepos(snapshot: ProjectIdentitySnapshot): GitRepos {
  const savedIdentity = readProjectIdentity(snapshot)
  let pruningIdentity: ProjectIdentity = savedIdentity
  // Every read below is cached, blocked and incomplete ones included, so one Scan sees one state.
  const pointers = new Map<string, string | null>()
  const commonDirs = new Map<string, string | null>()
  const gitDirs = new Map<string, { commonDir: string; index: WorktreeIndex | null }>()
  // A checkout whose `.git` file points at a git dir that isn't a worktree entry, keyed by that
  // git dir: a submodule or a `--separate-git-dir` repository.
  const mainCheckouts = new Map<string, string>()
  const worktrees = new Map<string, { path: string; commonDir: string }>()
  const containers = new Map<string, { path: string; commonDir: string }>()
  const canonicals = new Map<string, string | null>()
  let repos: Repo[] = []

  const readPointer = (checkout: string): string | null =>
    cached(pointers, checkout, () => readCheckoutGitdir(checkout))
  const commonDirOf = (gitdir: string): string | null =>
    cached(commonDirs, gitdir, () => readCommonDir(gitdir))
  const readGitDir = (commonDir: string): WorktreeIndex | null =>
    cached(gitDirs, commonDir, () => ({
      commonDir,
      index: readWorktreeIndex(commonDir, readPointer)
    })).index

  // Only a link saved for exactly this checkout; a link for a folder above it says nothing here.
  const saved = (path: string): string | undefined => {
    const match = savedIdentity.checkoutOf(path)
    return match && key(match.worktree) === key(path) ? match.canonical : undefined
  }
  const canonicalOf = (commonDir: string, paths: string[] = []): string | null =>
    cached(canonicals, commonDir, () => {
      const index = readGitDir(commonDir)
      const listed = index?.worktrees.map((entry) => entry.path) ?? []
      const live = new Set(
        index?.worktrees.filter((entry) => !entry.missing).map((entry) => key(entry.path)) ??
          paths.map(key)
      )
      const containerPaths = [...containers.values()]
        .filter((container) => key(container.commonDir) === key(commonDir))
        .map((container) => container.path)
      const previous = [...listed, ...paths, ...containerPaths]
        .map(saved)
        .find((path) => path !== undefined && live.has(key(path)))
      const main = mainCheckouts.get(key(commonDir))
      const choice = chooseCanonical(commonDir, index, paths, main, previous)
      const checkout = choice === null ? null : (allowedRealpathSync(choice) ?? choice)
      if (
        checkout === null ||
        isGitDirectoryPath(checkout) ||
        isWithinProjectPath(checkout, commonDir)
      )
        return null
      const directory = readAllowedDirectoryEntries(checkout)
      const listedLive = index?.worktrees.some(
        (worktree) => !worktree.missing && key(worktree.path) === key(checkout)
      )
      const redirect = index?.worktree
      const hasGit = directory.entries.some((entry) => entry.name === '.git')
      const valid =
        directory.status === 'unavailable' ||
        (directory.status === 'missing' && listedLive) ||
        (directory.status === 'ok' &&
          (hasGit ||
            (redirect && key(allowedRealpathSync(redirect) ?? redirect) === key(checkout))))
      return valid ? checkout : null
    })

  return {
    meet({ path, entries, asCheckout }) {
      const gitEntry = entries.find((entry) => entry.name === '.git')
      const pointer = gitEntry?.type === 'file' && !asCheckout ? readPointer(path) : null
      const gitFile = pointer === null ? null : (allowedRealpathSync(pointer) ?? pointer)
      const commonDir = gitFile === null ? null : commonDirOf(gitFile)
      if (commonDir === null && gitFile !== null && presenceOf(gitFile) === 'missing')
        return 'orphan'
      if (commonDir !== null) {
        if (!worktrees.has(key(path))) worktrees.set(key(path), { path, commonDir })
        // A worktree can be the only discoverable path into a separate git dir.
        readGitDir(commonDir)
        return 'worktree'
      }
      const gitDir = gitFile ?? (gitEntry?.type === 'directory' ? join(path, '.git') : null)
      const index = gitDir === null ? null : readGitDir(gitDir)
      if (gitFile !== null && index?.bare) {
        containers.set(key(path), { path, commonDir: gitFile })
        return 'bare-container'
      }
      if (gitFile !== null) mainCheckouts.set(key(gitFile), path)
      if (
        gitEntry?.type === 'directory' &&
        index?.worktree != null &&
        presenceOf(index.worktree) === 'present' &&
        !sameGitPath(index.worktree, path)
      )
        return 'git-dir-holder'
      if (gitEntry !== undefined) return index?.bare ? 'plain' : 'checkout'
      const names = new Set(entries.map((entry) => entry.name))
      return names.has('HEAD') && names.has('objects') && names.has('refs') && readGitDir(path)
        ? 'git-dir'
        : 'plain'
    },

    claimOrphan(path) {
      const lister = [...gitDirs.values()].find(({ index }) =>
        index?.worktrees.some((worktree) => key(worktree.path) === key(path))
      )
      if (!lister) return false
      worktrees.set(key(path), { path, commonDir: lister.commonDir })
      return true
    },

    resolve() {
      const redirects: string[] = []
      const gitDirHolders: string[] = []
      for (const { commonDir, index } of gitDirs.values()) {
        if (index?.bare || isNestedGitDirectory(commonDir)) continue
        const main = mainCheckouts.get(key(commonDir))
        const checkout = main ?? index?.worktree
        if (!checkout || (!main && presenceOf(checkout) !== 'present')) continue
        const location = allowedRealpathSync(checkout) ?? checkout
        // Only a `.git` dir makes its folder a checkout; a standalone git dir (a dotfiles repo with
        // core.worktree=$HOME) is reached through an alias, so git itself never treats that a checkout.
        if (basename(commonDir) !== '.git' || sameGitPath(dirname(commonDir), location)) continue
        gitDirHolders.push(dirname(commonDir))
        if (!main) redirects.push(location)
      }
      const groups = new Map<string, { commonDir: string; paths: string[] }>()
      for (const { path, commonDir } of worktrees.values()) {
        const group = groups.get(key(commonDir)) ?? { commonDir, paths: [] }
        group.paths.push(path)
        groups.set(key(commonDir), group)
      }
      // ponytail: every Canonical Checkout is chosen before the walk enters the kept ones, so a
      // `--separate-git-dir` checkout found inside one can't name another Repo's canonical;
      // choose per Repo between those walks if that layout ever turns up.
      repos = [...groups.values()].map(({ commonDir, paths }) => ({
        canonical: canonicalOf(commonDir, paths),
        worktrees: paths
      }))
      return { repos, redirects, gitDirHolders }
    },

    findings() {
      const links = new Map<string, WorktreeLink>()
      for (const { canonical, worktrees: paths } of repos)
        for (const path of paths)
          if (canonical !== null && key(path) !== key(canonical))
            links.set(key(path), { path, canonical })
      for (const { path, commonDir } of containers.values()) {
        const canonical = canonicalOf(commonDir)
        if (canonical !== null) links.set(key(path), { path, canonical })
      }
      // The checkout's own pointer wins when both sides can be read.
      for (const { commonDir, index } of gitDirs.values()) {
        if (index === null || isNestedGitDirectory(commonDir)) continue
        const canonical = canonicalOf(commonDir)
        if (canonical === null) continue
        for (const { path } of index.worktrees)
          if (key(path) !== key(canonical) && !links.has(key(path)))
            links.set(key(path), { path, canonical })
      }
      // Plugin pruning needs the Worktrees this Scan found before main records them.
      pruningIdentity = readProjectIdentity(snapshot, [...links.values()])
      return {
        worktrees: [...links.values()],
        canonicalCheckouts: [...gitDirs.values()].flatMap(({ commonDir, index }) => {
          const canonical = canonicals.get(key(commonDir))
          if (!index?.complete || !canonical) return []
          const repository = allowedDirectoryIdentitySync(commonDir)
          return [{ path: canonical, ...(repository === undefined ? {} : { repository }) }]
        })
      }
    },

    isPrunedWorktree(path, isMissingProject) {
      const link = pruningIdentity.checkoutOf(path)
      if (!link) return isMissingProject(path)
      const granted = isPathAllowed(link.worktree)
      if (granted && presenceOf(link.worktree) !== 'missing') return isMissingProject(path)
      const pointer = readPointer(link.canonical)
      const commonDir = pointer ? (commonDirOf(pointer) ?? pointer) : join(link.canonical, '.git')
      const index = readGitDir(commonDir)
      const listed = index?.worktrees.find((worktree) => sameGitPath(worktree.path, link.worktree))
      // Only the repository's own entry can say the folder was `locked` away rather than removed.
      if (granted) return listed ? listed.missing : index?.complete === true
      return (index?.complete === true && listed === undefined) || isMissingProject(path)
    }
  }
}
