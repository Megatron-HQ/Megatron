import { existsSync, readdirSync, readFileSync, realpathSync, statSync, type Stats } from 'fs'
import { homedir } from 'os'
import { resolve, sep } from 'path'

const TIER_1_ROOTS = ['skills', 'plugins', 'projects'].map((dir) =>
  resolve(homedir(), '.claude', dir)
)

// User-level Claude Code config — not under ~/.claude/{skills,plugins,projects}, but some
// scanners need specific fields out of them. File-only, not the rest of $HOME.
const TIER_1_FILES = [
  resolve(homedir(), '.claude.json'), // mcpServers, for the MCP linter
  resolve(homedir(), '.claude/settings.json') // enabledPlugins/skillOverrides, for disabled-skill detection
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
  if (!isPathAllowed(path)) return null
  try {
    return readFileSync(path)
  } catch {
    return null
  }
}
