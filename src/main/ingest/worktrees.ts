import { basename, dirname, isAbsolute, join, resolve, win32 } from 'path'
import type { WorktreeLink } from '../../shared/ipc'
import { normalizeProjectPath, worktreeLinkFor } from '../../shared/project-path'
import { readAllowedDirectoryEntries, readAllowedFile } from '../permissions'

export interface WorktreeIndex {
  // False when some entry couldn't be read, so absence from `worktrees` proves nothing.
  complete: boolean
  bare: boolean
  head: string | null
  worktrees: { path: string; branch: string | null }[]
}

// Both a worktree's `.git` file (`gitdir: <path>`) and git's own `worktrees/<name>/gitdir` (bare
// path) point somewhere; `worktree.useRelativePaths` makes either relative to the file's folder.
// Git writes `C:/…` on Windows, which only win32 recognizes as absolute, and posix `resolve`
// would collapse a UNC `//server` prefix, so absolute pointers are returned as written.
export function parseGitdir(content: string, fileDir: string): string | null {
  const pointer = content.replace(/^gitdir:/, '').trim()
  if (!pointer) return null
  return isAbsolute(pointer) || win32.isAbsolute(pointer) ? pointer : resolve(fileDir, pointer)
}

const WORKTREE_GITDIR = /^(.+)[\\/]worktrees[\\/][^\\/]+[\\/]?$/
// A submodule's git dir is <repo>/.git/modules/<name>; it and its own worktrees are separate repos.
const SUBMODULE_GITDIR = /[\\/]modules[\\/][^\\/]+$/

export function worktreeCommonDir(gitdir: string): string | null {
  const match = WORKTREE_GITDIR.exec(gitdir)
  return match && !SUBMODULE_GITDIR.test(match[1]) ? match[1] : null
}

function readText(path: string): { status: 'ok' | 'missing' | 'unavailable'; text: string } {
  const read = readAllowedFile(path, 64 * 1024)
  return read.status === 'ok' && read.contents !== null
    ? { status: 'ok', text: read.contents.toString('utf8') }
    : { status: read.status === 'missing' ? 'missing' : 'unavailable', text: '' }
}

function headBranch(text: string): string | null {
  return /^ref:\s*refs\/heads\/(.+?)\s*$/m.exec(text)?.[1] ?? null
}

// Null when the git dir can't be listed (ungranted, gone, or a worktree's `.git` file): nothing
// is known about it, not even whether it is bare.
export function readWorktreeIndex(commonDir: string): WorktreeIndex | null {
  if (readAllowedDirectoryEntries(commonDir).status !== 'ok') return null
  const config = readText(join(commonDir, 'config'))
  const index: WorktreeIndex = {
    complete: config.status !== 'unavailable',
    bare: /^\s*bare\s*=\s*true\s*$/im.test(config.text),
    head: headBranch(readText(join(commonDir, 'HEAD')).text),
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
    index.worktrees.push({
      path: dirname(pointer),
      branch: headBranch(readText(join(entry, 'HEAD')).text)
    })
  }
  return index
}

// `main` is a checkout whose own `.git` file points at this git dir (`--separate-git-dir`).
// Null only for a bare repository with no worktree anywhere: nothing is checked out.
export function chooseCanonical(
  commonDir: string,
  index: WorktreeIndex | null,
  candidates: string[] = [],
  main?: string
): string | null {
  if (main !== undefined) return main
  if (index ? !index.bare : basename(commonDir) === '.git') return dirname(commonDir)
  const listed = index?.worktrees ?? []
  // ponytail: first by path shifts when worktrees come and go; persist the choice if that churns.
  const pool = [
    ...(listed.length > 0 ? listed : candidates.map((path) => ({ path, branch: null })))
  ].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return (
    (pool.find((worktree) => index?.head && worktree.branch === index.head) ?? pool[0])?.path ??
    null
  )
}

// `git worktree remove` and `prune` only drop an entry once its folder is gone, and `move`
// rewrites the entry with the new path, so a link its readable repository no longer lists is a
// folder that no longer exists.
export function createPrunedWorktreeCheck(
  links: readonly WorktreeLink[]
): (path: string) => boolean {
  const indexes = new Map<string, WorktreeIndex | null>()
  return (path) => {
    const link = worktreeLinkFor(path, links)
    if (!link) return false
    // ponytail: a bare repository's Canonical Checkout has a `.git` file, so its worktrees are
    // never reported pruned; follow that file to the shared git dir if phantom installs persist.
    const commonDir = join(link.canonical, '.git')
    const key = normalizeProjectPath(commonDir)
    const index = indexes.has(key) ? indexes.get(key) : readWorktreeIndex(commonDir)
    indexes.set(key, index ?? null)
    return (
      index != null &&
      index.complete &&
      !index.worktrees.some(
        (worktree) => normalizeProjectPath(worktree.path) === normalizeProjectPath(link.path)
      )
    )
  }
}
