import { statSync } from 'fs'
import { isSuggestableFolder } from '../shared/grant-suggestions'

// The one capability outside isPathAllowed (docs/security-hardening.md): checking that a folder
// Claude Code recorded exists. Nothing inside the folder is ever read.

export function isExistingDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

// Only proof counts: a folder that can't be looked up, or is offline, may still be there.
function isGoneDirectory(path: string): boolean {
  try {
    return !statSync(path).isDirectory()
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return code === 'ENOENT' || code === 'ENOTDIR'
  }
}

// Granted folders are left to the live check that reads through the grant.
export function goneRecordedFolders(
  paths: readonly string[],
  home: string,
  allowed: (path: string) => boolean
): string[] {
  return paths.filter(
    (path) => isSuggestableFolder(path, home) && !allowed(path) && isGoneDirectory(path)
  )
}
