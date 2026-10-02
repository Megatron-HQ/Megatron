import {
  closeSync,
  existsSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
  statSync,
  type Stats
} from 'fs'
import { homedir } from 'os'
import { resolve, sep } from 'path'
import { StringDecoder } from 'string_decoder'

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

const grantedPaths = new Set<string>()

export function grantPath(path: string): void {
  grantedPaths.add(resolve(path))
}

export function revokePath(path: string): void {
  grantedPaths.delete(resolve(path))
}

export function resetGrantedPaths(): void {
  grantedPaths.clear()
}

export function getGrantedPaths(): string[] {
  return [...grantedPaths]
}

function normalizeFsPath(p: string): string {
  return process.platform === 'win32' ? p.toLowerCase() : p
}

export function isPathAllowed(path: string): boolean {
  const resolved = normalizeFsPath(resolve(path))
  if (TIER_1_FILES.some((file) => normalizeFsPath(file) === resolved)) return true
  for (const root of [...TIER_1_ROOTS, ...grantedPaths]) {
    const normalizedRoot = normalizeFsPath(root)
    if (resolved === normalizedRoot || resolved.startsWith(normalizedRoot + sep)) return true
  }
  return false
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

export function readAllowedDirectory(dirPath: string): AllowedDirectoryRead {
  if (!isPathAllowed(dirPath)) return { entries: [], status: 'unavailable' }
  try {
    return { entries: readdirSync(dirPath), status: 'ok' }
  } catch (error) {
    const code =
      error instanceof Error && 'code' in error ? (error as NodeJS.ErrnoException).code : undefined
    return { entries: [], status: code === 'ENOENT' ? 'missing' : 'unavailable' }
  }
}

export function allowedExistsSync(path: string): boolean {
  return isPathAllowed(path) && existsSync(path)
}

export function allowedStatSync(path: string): Stats | null {
  if (!isPathAllowed(path)) return null
  try {
    return statSync(path)
  } catch {
    return null
  }
}

// Canonical paths let callers detect cycles while preserving the locked behavior of following a
// symlink rooted at an allowed path. The permission check deliberately applies to the link path.
export function allowedRealpathSync(path: string): string | null {
  if (!isPathAllowed(path)) return null
  try {
    return realpathSync(path)
  } catch {
    return null
  }
}

export function allowedReadFileSync(path: string): Buffer | null {
  return readAllowedFile(path).contents
}

const MAX_FILE_READ_BYTES = 16 * 1024 * 1024
const MAX_TRANSCRIPT_LINE_BYTES = 64 * 1024 * 1024

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
    descriptor = openSync(path, 'r')
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
    fileDescriptor = openSync(path, 'r')
  } catch (error) {
    const code =
      error instanceof Error && 'code' in error ? (error as NodeJS.ErrnoException).code : undefined
    return code === 'ENOENT' ? 'missing' : 'unavailable'
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
