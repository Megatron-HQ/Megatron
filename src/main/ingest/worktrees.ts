import { basename, dirname, isAbsolute, join, resolve, win32 } from 'path'
import type { WorktreeLink } from '../../shared/ipc'
import {
  isGitDirectoryPath,
  normalizeProjectPath,
  worktreeLinkFor
} from '../../shared/project-path'
import {
  allowedPathLocationSync,
  allowedRealpathSync,
  allowedStatSync,
  isPathAllowed,
  readAllowedDirectoryEntries,
  readAllowedFile
} from '../permissions'
import { readReftableHead } from './reftable'

const MAX_GIT_METADATA_BYTES = 64 * 1024

export interface WorktreeIndex {
  // False when some entry couldn't be read, so absence from `worktrees` proves nothing.
  complete: boolean
  bare: boolean
  head: string | null
  worktree: string | null
  worktrees: { path: string; branch: string | null; missing: boolean }[]
}

// Both a worktree's `.git` file (`gitdir: <path>`) and git's own `worktrees/<name>/gitdir` (bare
// path) point somewhere; `worktree.useRelativePaths` makes either relative to the file's folder.
// Git writes `C:/…` on Windows, which only win32 recognizes as absolute, and posix `resolve`
// would collapse a UNC `//server` prefix, so absolute pointers are returned as written.
function resolveGitPath(
  pointer: string,
  fileDir: string,
  platform: NodeJS.Platform
): string | null {
  if (!pointer || pointer.includes('\0') || (platform === 'win32' && /^\/(?!\/)/.test(pointer)))
    return null
  return isAbsolute(pointer) || win32.isAbsolute(pointer) ? pointer : resolve(fileDir, pointer)
}

export function parseGitdir(
  content: string,
  fileDir: string,
  platform = process.platform
): string | null {
  return resolveGitPath(content.replace(/^gitdir:/, '').trim(), fileDir, platform)
}

const WORKTREE_GITDIR = /^(.+)[\\/]worktrees[\\/][^\\/]+[\\/]?$/

export function isNestedGitDirectory(gitdir: string): boolean {
  return isGitDirectoryPath(dirname(normalizeProjectPath(gitdir)))
}

// Gone only when an existing granted folder above it shows it gone: a path outside every grant,
// or a whole grant that is missing (an unmounted volume), proves nothing either way.
export function presenceOf(path: string): 'present' | 'missing' | 'unknown' {
  if (!isPathAllowed(path)) return 'unknown'
  if (allowedStatSync(path) !== null) return 'present'
  return readAllowedDirectoryEntries(path, 1).status === 'missing' &&
    allowedPathLocationSync(path) !== null
    ? 'missing'
    : 'unknown'
}

export function commonDirOf(gitdir: string): string | null {
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

function readText(path: string): { status: 'ok' | 'missing' | 'unavailable'; text: string } {
  const read = readAllowedFile(path, MAX_GIT_METADATA_BYTES)
  return read.status === 'ok' && read.contents !== null
    ? { status: 'ok', text: read.contents.toString('utf8') }
    : { status: read.status === 'missing' ? 'missing' : 'unavailable', text: '' }
}

export function readCheckoutGitdir(checkout: string): string | null {
  const { text } = readText(join(checkout, '.git'))
  return text.startsWith('gitdir:') ? parseGitdir(text, checkout) : null
}

export function sameGitPath(first: string, second: string): boolean {
  if (normalizeProjectPath(first) === normalizeProjectPath(second)) return true
  const real = allowedRealpathSync(first)
  const other = allowedRealpathSync(second)
  if (real !== null && other !== null && normalizeProjectPath(real) === normalizeProjectPath(other))
    return true
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

const GIT_CONFIG_ESCAPES: Record<string, string> = {
  '\\': '\\',
  '"': '"',
  n: '\n',
  t: '\t',
  b: '\b'
}

function configValue(raw: string): string | undefined {
  let value = ''
  let end = 0
  let quoted = false
  for (let index = 0; index < raw.length; index++) {
    const char = raw[index]
    if (char === '"') quoted = !quoted
    else if (!quoted && (char === '#' || char === ';')) break
    else if (char === '\\') {
      const escaped = GIT_CONFIG_ESCAPES[raw[++index]]
      if (escaped === undefined) return undefined
      value += escaped
      end = value.length
    } else {
      value += char
      if (quoted || !/\s/.test(char)) end = value.length
    }
  }
  return quoted ? undefined : value.slice(0, end)
}

function gitBoolean(raw: string | true | undefined): boolean {
  if (raw === true) return true
  const value = raw?.trim().toLowerCase() ?? ''
  if (['true', 'yes', 'on'].includes(value)) return true
  return /^[+-]?\d+$/.test(value) && /[1-9]/.test(value)
}

// shortcut: include/includeIf are ignored; resolve permitted includes if real layouts need them.
function parseGitConfig(config: string): Map<string, string | true> {
  const values = new Map<string, string | true>()
  let section = ''
  for (let line of config.replace(/(^|[^\\])((?:\\\\)*)\\\r?\n/g, '$1$2').split(/\r?\n/)) {
    const header = /^\s*\[([^\]]*)\](.*)$/.exec(line)
    if (header) {
      section = header[1].trim().toLowerCase()
      line = header[2]
    }
    const entry = /^\s*([a-z][\w-]*)\s*(?:$|[#;]|=\s*(.*))/i.exec(line)
    if (!entry || (section !== 'core' && section !== 'extensions')) continue
    const value = entry[2] === undefined ? true : configValue(entry[2])
    if (value !== undefined) values.set(section + '.' + entry[1].toLowerCase(), value)
  }
  return values
}

export function coreBare(config: string): boolean {
  return gitBoolean(parseGitConfig(config).get('core.bare'))
}

function headBranch(text: string): string | null {
  return /^ref:\s*refs\/heads\/(.+?)\s*$/m.exec(text)?.[1] ?? null
}

// Null when the git dir can't be listed (ungranted, gone, or a worktree's `.git` file): nothing
// is known about it, not even whether it is bare.
export function readWorktreeIndex(commonDir: string): WorktreeIndex | null {
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
    if (normalizeProjectPath(basename(pointer)) !== '.git') continue
    const path = dirname(pointer)
    const reverse = readCheckoutGitdir(path)
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
export function chooseCanonical(
  commonDir: string,
  index: WorktreeIndex | null,
  candidates: readonly string[] = [],
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

export function createPrunedWorktreeCheck(
  links: readonly WorktreeLink[],
  isMissingProject: (path: string) => boolean = () => false
): (path: string) => boolean {
  const indexes = new Map<string, WorktreeIndex | null>()
  const commonDirs = new Map<string, string>()
  return (path) => {
    const link = worktreeLinkFor(path, links)
    if (!link) return isMissingProject(path)
    const granted = isPathAllowed(link.path)
    if (granted && presenceOf(link.path) !== 'missing') return isMissingProject(path)
    const checkout = normalizeProjectPath(link.canonical)
    let commonDir = commonDirs.get(checkout)
    if (commonDir === undefined) {
      const pointer = readCheckoutGitdir(link.canonical)
      commonDir = pointer ? (commonDirOf(pointer) ?? pointer) : join(link.canonical, '.git')
      commonDirs.set(checkout, commonDir)
    }
    const key = normalizeProjectPath(commonDir)
    if (!indexes.has(key)) indexes.set(key, readWorktreeIndex(commonDir))
    const index = indexes.get(key)
    const listed = index?.worktrees.find((worktree) => sameGitPath(worktree.path, link.path))
    // Only the repository's own entry can say the folder was `locked` away rather than removed.
    if (granted) return listed ? listed.missing : index?.complete === true
    return (index?.complete === true && listed === undefined) || isMissingProject(path)
  }
}
