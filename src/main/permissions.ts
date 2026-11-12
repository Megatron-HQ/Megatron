import {
  closeSync,
  chmodSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  opendirSync,
  realpathSync,
  statSync,
  watch,
  type FSWatcher,
  type Stats
} from 'fs'
import { homedir } from 'os'
import { basename, dirname, isAbsolute, join, resolve, sep } from 'path'
import { StringDecoder } from 'string_decoder'
import { execFileSync } from 'child_process'

const WINDOWS_CACHE_ACL_SCRIPT = `
$ErrorActionPreference = 'Stop'
$identitySid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$directoryAcl = [System.Security.AccessControl.DirectorySecurity]::new()
$directoryAcl.SetSecurityDescriptorSddlForm('D:P(A;OICI;FA;;;' + $identitySid + ')(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)', [System.Security.AccessControl.AccessControlSections]::Access)
if ($env:MEGATRON_PRIVATE_DATA_RESTRICT_DIRECTORY -eq '1') {
[System.IO.Directory]::SetAccessControl($env:MEGATRON_PRIVATE_DATA_DIRECTORY, $directoryAcl)
}
if (![string]::IsNullOrEmpty($env:MEGATRON_PRIVATE_DATA_FILES)) {
foreach ($file in $env:MEGATRON_PRIVATE_DATA_FILES.Split([char[]]@('|'), [System.StringSplitOptions]::RemoveEmptyEntries)) {
  $fileAcl = [System.Security.AccessControl.FileSecurity]::new()
  $fileAcl.SetSecurityDescriptorSddlForm('D:P(A;;FA;;;' + $identitySid + ')(A;;FA;;;SY)(A;;FA;;;BA)', [System.Security.AccessControl.AccessControlSections]::Access)
  try {
    [System.IO.File]::SetAccessControl($file, $fileAcl)
  } catch [System.IO.FileNotFoundException] {
    # SQLite deletes a -wal/-shm sidecar when its last connection closes, which can happen after
    # Megatron inspected the directory. A file that no longer exists has nothing left to protect.
  }
}
}
# -EncodedCommand's exit code follows the last statement's success, which a caught exception leaves
# false. Uncaught errors still stop the script above with a nonzero code under 'Stop'.
exit 0
`

const TIER_1_ROOTS = ['skills', 'plugins', 'projects'].map((dir) =>
  resolve(homedir(), '.claude', dir)
)

// User-level Claude Code config — not under ~/.claude/{skills,plugins,projects}, but some
// scanners need specific fields out of them. File-only, not the rest of $HOME.
const TIER_1_FILES = [
  resolve(homedir(), '.claude.json'), // mcpServers, for the MCP linter
  resolve(homedir(), '.claude/settings.json'), // enabledPlugins/skillOverrides, for disabled-skill detection
  resolve(homedir(), '.claude/history.jsonl') // Prompt History, for the Usage view
]

const grantedPaths = new Map<string, string>()
const MAX_DIRECTORY_ENTRIES = 20_000

// Separate from grantPath so a pick can be classified against existing grants before it becomes
// readable: registering a pick that ends up skipped would outlive its covering grant's revocation.
export function canonicalGrantPath(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    /* A not-yet-created grant remains anchored to its absolute path. */
    return resolve(path)
  }
}

export function grantPath(path: string): string {
  const canonical = canonicalGrantPath(path)
  grantedPaths.set(resolve(path), canonical)
  return canonical
}

export function restoreGrantedPath(path: string): void {
  const pinned = resolve(path)
  grantedPaths.set(pinned, pinned)
}

export function revokePath(path: string): void {
  const normalized = normalizeFsPath(resolve(path))
  for (const [selected, canonical] of grantedPaths)
    if (normalizeFsPath(selected) === normalized || normalizeFsPath(canonical) === normalized)
      grantedPaths.delete(selected)
}

export function resetGrantedPaths(): void {
  grantedPaths.clear()
}

export function getGrantedPaths(): string[] {
  return [...new Set(grantedPaths.values())]
}

function normalizeFsPath(p: string): string {
  return process.platform === 'win32' ? p.toLowerCase() : p
}

// The one containment rule: grant overlap (folder-grants.ts) must agree with access exactly.
export function isWithinGrant(path: string, root: string): boolean {
  const resolved = normalizeFsPath(resolve(path))
  const normalizedRoot = normalizeFsPath(resolve(root))
  // A filesystem root (`/`, `D:\`) already ends in a separator.
  const prefix = normalizedRoot.endsWith(sep) ? normalizedRoot : normalizedRoot + sep
  return resolved === normalizedRoot || resolved.startsWith(prefix)
}

export function isPathAllowed(path: string): boolean {
  const resolved = normalizeFsPath(resolve(path))
  if (TIER_1_FILES.some((file) => normalizeFsPath(file) === resolved)) return true
  return [...TIER_1_ROOTS, ...grantedPaths.keys(), ...grantedPaths.values()].some((root) =>
    isWithinGrant(path, root)
  )
}

// CLI discovery is a separate capability: candidate names come from the fixed resolver, not IPC.
// Never grant these executable locations to the skill/file-viewing permission set.
export function inspectCliCandidate(
  candidate: string,
  excludedDirectories: string[]
): string | null {
  if (!isAbsolute(candidate) || candidate.startsWith('\\\\')) return null
  try {
    const canonical = realpathSync(candidate)
    const normalized = normalizeFsPath(canonical)
    if (
      excludedDirectories.some((directory) => {
        const root = normalizeFsPath(resolve(directory))
        let realRoot = root
        try {
          realRoot = normalizeFsPath(realpathSync(directory))
        } catch {
          /* Absent roots cannot contain an executable. */
        }
        return (
          normalized === root ||
          normalized.startsWith(root + sep) ||
          normalized === realRoot ||
          normalized.startsWith(realRoot + sep)
        )
      })
    )
      return null
    return statSync(canonical).isFile() ? canonical : null
  } catch {
    return null
  }
}

export function inspectCliDirectory(
  candidate: string,
  excludedDirectories: string[]
): string | null {
  if (!isAbsolute(candidate) || candidate.startsWith('\\\\')) return null
  try {
    const canonical = realpathSync(candidate)
    const normalized = normalizeFsPath(canonical)
    if (
      excludedDirectories.some((directory) => {
        let root = resolve(directory)
        try {
          root = realpathSync(directory)
        } catch {
          /* Keep the absolute exclusion for absent directories. */
        }
        const normalizedRoot = normalizeFsPath(root)
        return normalized === normalizedRoot || normalized.startsWith(normalizedRoot + sep)
      })
    )
      return null
    return statSync(canonical).isDirectory() ? canonical : null
  } catch {
    return null
  }
}

// An app-owned cache capability. Callers supply Electron's userData path, never an IPC path.
export function securePrivateDataDirectory(directory: string, ownedRoot?: string): void {
  let existed = false
  try {
    lstatSync(directory)
    existed = true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  const restrictDirectory =
    !existed ||
    (ownedRoot !== undefined &&
      normalizeFsPath(resolve(directory)) === normalizeFsPath(resolve(ownedRoot)))
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  if (lstatSync(directory).isSymbolicLink()) throw new Error('Application data directory is linked')
  const files: string[] = []
  for (const name of [
    'megatron.db',
    'megatron.db-wal',
    'megatron.db-shm',
    'preferences.json',
    'usage-history.db',
    'usage-history.db-wal',
    'usage-history.db-shm'
  ]) {
    const file = join(directory, name)
    try {
      const stats = lstatSync(file)
      if (stats.isSymbolicLink() || !stats.isFile() || stats.nlink > 1)
        throw new Error('Application cache contains a linked or special file')
      files.push(file)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }
  if (process.platform !== 'win32') {
    if (restrictDirectory) chmodSync(directory, 0o700)
    for (const file of files) chmodSync(file, 0o600)
  } else {
    secureWindowsPrivateData({ directory, restrictDirectory, files })
  }
}

// Each PowerShell launch blocks the main process for roughly 300 ms, so this process changes a
// directory or file at most once. A directory it locked carries a protected, inheritable ACL: every
// file present then was changed in the same launch, and every file created later inherits the ACL.
const lockedWindowsDirectories = new Set<string>()
const securedWindowsFiles = new Set<string>()

function secureWindowsPrivateData({
  directory,
  restrictDirectory,
  files
}: WindowsPrivateDataAclChange): void {
  const directoryKey = normalizeFsPath(resolve(directory))
  if (lockedWindowsDirectories.has(directoryKey)) return
  const change = {
    directory,
    restrictDirectory,
    files: files.filter((file) => !securedWindowsFiles.has(normalizeFsPath(file)))
  }
  if (!change.restrictDirectory && change.files.length === 0) return
  try {
    applyWindowsPrivateDataAcl(change)
  } catch (error) {
    // Fails open: blocked PowerShell (policy, Constrained Language Mode, endpoint security) must not
    // make the app unusable, and the default %APPDATA% location already inherits a private ACL. The
    // linked/special-file checks above still fail closed. Nothing is recorded, so the next call retries.
    console.warn('[private-data] could not restrict application data permissions', error)
    return
  }
  if (change.restrictDirectory) lockedWindowsDirectories.add(directoryKey)
  for (const file of change.files) securedWindowsFiles.add(normalizeFsPath(file))
}

export interface WindowsPrivateDataAclChange {
  directory: string
  restrictDirectory: boolean
  files: string[]
}

export function applyWindowsPrivateDataAcl({
  directory,
  restrictDirectory,
  files
}: WindowsPrivateDataAclChange): void {
  const powershell = join(
    process.env.SystemRoot ?? 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe'
  )
  execFileSync(
    powershell,
    [
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(WINDOWS_CACHE_ACL_SCRIPT, 'utf16le').toString('base64')
    ],
    {
      windowsHide: true,
      timeout: 10_000,
      env: {
        ...process.env,
        MEGATRON_PRIVATE_DATA_DIRECTORY: directory,
        MEGATRON_PRIVATE_DATA_RESTRICT_DIRECTORY: restrictDirectory ? '1' : '0',
        MEGATRON_PRIVATE_DATA_FILES: files.join('|')
      }
    }
  )
}

// Every other fs read must go through one of these rather than calling
// node:fs directly — isPathAllowed() is only a real chokepoint if callers
// can't reach the filesystem without passing it.

export function allowedReaddirSync(dirPath: string): string[] {
  return readAllowedDirectory(dirPath).entries
}

export interface AllowedDirectoryRead {
  entries: string[]
  status: 'ok' | 'missing' | 'unavailable'
}

export interface AllowedDirectoryEntry {
  name: string
  type: 'directory' | 'file' | 'symlink' | 'other'
}

export function readAllowedDirectory(
  dirPath: string,
  maximumEntries = MAX_DIRECTORY_ENTRIES
): AllowedDirectoryRead {
  const result = readAllowedDirectoryEntries(dirPath, maximumEntries)
  return { status: result.status, entries: result.entries.map((entry) => entry.name) }
}

export function readAllowedDirectoryEntries(
  dirPath: string,
  maximumEntries = MAX_DIRECTORY_ENTRIES
): { entries: AllowedDirectoryEntry[]; status: AllowedDirectoryRead['status'] } {
  if (!isPathAllowed(dirPath)) return { entries: [], status: 'unavailable' }
  try {
    const canonical = realpathSync(dirPath)
    if (!isPathAllowed(canonical)) return { entries: [], status: 'unavailable' }
    const directory = opendirSync(canonical)
    const entries: AllowedDirectoryEntry[] = []
    const sorted = (): AllowedDirectoryEntry[] =>
      entries.sort((first, second) =>
        first.name < second.name ? -1 : first.name > second.name ? 1 : 0
      )
    // Replay ownership must not depend on the filesystem's enumeration order.
    try {
      for (let entry = directory.readSync(); entry !== null; entry = directory.readSync()) {
        if (entries.length >= maximumEntries) return { entries: sorted(), status: 'unavailable' }
        entries.push({
          name: entry.name,
          type: entry.isSymbolicLink()
            ? 'symlink'
            : entry.isDirectory()
              ? 'directory'
              : entry.isFile()
                ? 'file'
                : 'other'
        })
      }
      return { entries: sorted(), status: 'ok' }
    } finally {
      directory.closeSync()
    }
  } catch (error) {
    const code =
      error instanceof Error && 'code' in error ? (error as NodeJS.ErrnoException).code : undefined
    return {
      entries: [],
      status: code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' : 'unavailable'
    }
  }
}

export function allowedExistsSync(path: string): boolean {
  return allowedRealpathSync(path) !== null
}

export function allowedStatSync(path: string): Stats | null {
  if (!isPathAllowed(path)) return null
  try {
    const canonical = realpathSync(path)
    return isPathAllowed(canonical) ? statSync(canonical) : null
  } catch {
    return null
  }
}

// Linked skills require both their discovered path and their resolved target to be approved.
export function allowedRealpathSync(path: string): string | null {
  if (!isPathAllowed(path)) return null
  try {
    const canonical = realpathSync(path)
    return isPathAllowed(canonical) ? canonical : null
  } catch {
    return null
  }
}

// Resolve descriptive locations after deletion, without treating a denied or broken link as absent.
export function allowedPathLocationSync(path: string): string | null {
  let ancestor = resolve(path)
  const missingSegments: string[] = []
  while (isPathAllowed(ancestor)) {
    try {
      lstatSync(ancestor)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return null
      const parent = dirname(ancestor)
      if (parent === ancestor) return null
      missingSegments.unshift(basename(ancestor))
      ancestor = parent
      continue
    }
    const canonical = allowedRealpathSync(ancestor)
    if (canonical === null) return null
    if (missingSegments.length > 0 && allowedStatSync(ancestor)?.isDirectory() !== true) return null
    const location = join(canonical, ...missingSegments)
    return isPathAllowed(location) ? location : null
  }
  return null
}

export function watchAllowedPath(
  path: string,
  onChange: (event: string, filename: string | null) => void,
  onError: (error: Error) => void
): FSWatcher {
  if (!isPathAllowed(path))
    throw Object.assign(new Error('Path is not approved'), { code: 'EACCES' })
  const canonical = realpathSync(path)
  if (!isPathAllowed(canonical))
    throw Object.assign(new Error('Path is not approved'), { code: 'EACCES' })
  const watcher = watch(
    canonical,
    { recursive: statSync(canonical).isDirectory() },
    (event, filename) => {
      if (allowedRealpathSync(path) !== canonical) {
        watcher.close()
        onChange(event, null)
        return
      }
      onChange(event, filename?.toString() ?? null)
    }
  )
  watcher.on('error', (error) => {
    watcher.close()
    onError(error)
  })
  return watcher
}

export function allowedReadFileSync(path: string): Buffer | null {
  return readAllowedFile(path).contents
}

const MAX_FILE_READ_BYTES = 16 * 1024 * 1024
const MAX_TRANSCRIPT_LINE_BYTES = 64 * 1024 * 1024

function openAllowedRegularFile(path: string): number {
  const canonical = realpathSync(path)
  if (!isPathAllowed(canonical))
    throw Object.assign(new Error('Unapproved file target'), { code: 'EACCES' })
  const before = statSync(canonical, { bigint: true })
  if (!before.isFile())
    throw Object.assign(new Error('Only regular files can be read'), { code: 'EACCES' })
  const descriptor = openSync(
    canonical,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0)
  )
  try {
    const opened = fstatSync(descriptor, { bigint: true })
    const after = realpathSync(path)
    const afterStats = statSync(after, { bigint: true })
    if (
      !opened.isFile() ||
      opened.dev !== afterStats.dev ||
      opened.ino !== afterStats.ino ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      normalizeFsPath(after) !== normalizeFsPath(canonical) ||
      !isPathAllowed(after)
    )
      throw Object.assign(new Error('File target changed during open'), { code: 'EACCES' })
    return descriptor
  } catch (error) {
    closeSync(descriptor)
    throw error
  }
}

export function readAllowedFile(
  path: string,
  maxBytes = MAX_FILE_READ_BYTES
): {
  status: AllowedFileReadStatus | 'too_large'
  contents: Buffer | null
} {
  if (!isPathAllowed(path)) return { status: 'unavailable', contents: null }
  let descriptor: number
  try {
    descriptor = openAllowedRegularFile(path)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return {
      status: code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' : 'unavailable',
      contents: null
    }
  }
  try {
    const chunks: Buffer[] = []
    let total = 0
    while (true) {
      const chunk = Buffer.allocUnsafe(Math.min(STREAM_READ_CHUNK_BYTES, maxBytes - total + 1))
      const count = readSync(descriptor, chunk, 0, chunk.length, null)
      if (count === 0) return { status: 'ok', contents: Buffer.concat(chunks, total) }
      total += count
      if (total > maxBytes) return { status: 'too_large', contents: null }
      chunks.push(chunk.subarray(0, count))
    }
  } catch {
    return { status: 'unavailable', contents: null }
  } finally {
    closeSync(descriptor)
  }
}

export type AllowedFileReadStatus = 'ok' | 'missing' | 'unavailable'

const STREAM_READ_CHUNK_BYTES = 64 * 1024

export function visitAllowedUtf8LinesSync(
  path: string,
  visitLine: (line: string) => void,
  maxLineBytes = MAX_TRANSCRIPT_LINE_BYTES
): AllowedFileReadStatus {
  if (!isPathAllowed(path)) return 'unavailable'

  let fileDescriptor: number
  try {
    fileDescriptor = openAllowedRegularFile(path)
  } catch (error) {
    const code =
      error instanceof Error && 'code' in error ? (error as NodeJS.ErrnoException).code : undefined
    return code === 'ENOENT' || code === 'ENOTDIR' ? 'missing' : 'unavailable'
  }

  const buffer = Buffer.allocUnsafe(STREAM_READ_CHUNK_BYTES)
  const decoder = new StringDecoder('utf8')
  let fragments: string[] = []
  let pendingBytes = 0
  const consume = (text: string): boolean => {
    let start = 0
    while (start < text.length) {
      const newline = text.indexOf('\n', start)
      const fragment = text.slice(start, newline === -1 ? text.length : newline)
      pendingBytes += Buffer.byteLength(fragment)
      if (pendingBytes > maxLineBytes) return false
      fragments.push(fragment)
      if (newline === -1) break
      const line = fragments.join('')
      visitLine(line.endsWith('\r') ? line.slice(0, -1) : line)
      fragments = []
      pendingBytes = 0
      start = newline + 1
    }
    return true
  }

  try {
    while (true) {
      const bytesRead = readSync(fileDescriptor, buffer, 0, buffer.length, null)
      if (bytesRead === 0) break
      if (!consume(decoder.write(buffer.subarray(0, bytesRead)))) return 'unavailable'
    }
    if (!consume(decoder.end())) return 'unavailable'
    const pending = fragments.join('')
    if (pending !== '') visitLine(pending.endsWith('\r') ? pending.slice(0, -1) : pending)
    return 'ok'
  } catch (error) {
    if (!(error instanceof Error && 'code' in error)) throw error
    return 'unavailable'
  } finally {
    closeSync(fileDescriptor)
  }
}
