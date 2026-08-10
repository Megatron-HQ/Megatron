import { homedir } from 'os'
import { resolve, sep } from 'path'

const TIER_1_ROOTS = ['skills', 'plugins', 'projects'].map((dir) =>
  resolve(homedir(), '.claude', dir)
)

const grantedPaths = new Set<string>()

export function grantPath(path: string): void {
  grantedPaths.add(resolve(path))
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
