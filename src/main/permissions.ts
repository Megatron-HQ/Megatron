import { existsSync, readdirSync, readFileSync, statSync, type Stats } from 'fs'
import { homedir } from 'os'
import { resolve, sep } from 'path'

const TIER_1_ROOTS = ['skills', 'plugins', 'projects'].map((dir) =>
  resolve(homedir(), '.claude', dir)
)

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

export function isPathAllowed(path: string): boolean {
  const resolved = resolve(path)
  for (const root of [...TIER_1_ROOTS, ...grantedPaths]) {
    if (resolved === root || resolved.startsWith(root + sep)) return true
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
