export function normalizeProjectPath(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '') || '/'
  return /^(?:[a-z]:|\/\/)/i.test(normalized) ? normalized.toLowerCase() : normalized
}

export function isWithinProjectPath(path: string, parent: string): boolean {
  const candidate = normalizeProjectPath(path)
  const root = normalizeProjectPath(parent)
  return candidate === root || candidate.startsWith(root.endsWith('/') ? root : `${root}/`)
}

export function isGitDirectoryPath(path: string): boolean {
  return normalizeProjectPath(path).split('/').includes('.git')
}

// Hiding covers a folder's descendants, so a project recorded from a subfolder hides with it.
export function isHiddenProject(path: string, hidden: readonly string[]): boolean {
  return hidden.some((folder) => isWithinProjectPath(path, folder))
}
