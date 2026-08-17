import { existsSync, readdirSync, readFileSync, statSync, type Stats } from 'fs'
import { homedir } from 'os'
import { resolve, sep } from 'path'

const TIER_1_ROOTS = ['skills', 'plugins', 'projects'].map((dir) =>
  resolve(homedir(), '.claude', dir)
)

// User-level Claude Code config — not under ~/.claude/{skills,plugins,projects}, but the MCP
// linter has to read mcpServers from it. File-only, not the rest of $HOME.
const TIER_1_FILES = [resolve(homedir(), '.claude.json')]

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
  if (!isPathAllowed(dirPath)) return []
  try {
    return readdirSync(dirPath)
  } catch {
    return []
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

export function allowedReadFileSync(path: string): Buffer | null {
  if (!isPathAllowed(path)) return null
  try {
    return readFileSync(path)
  } catch {
    return null
  }
}
