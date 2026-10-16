export function normalizeProjectPath(path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/\/+$/, '') || '/'
  return /^(?:[a-z]:|\/\/)/i.test(normalized) ? normalized.toLowerCase() : normalized
}

export function isWithinProjectPath(path: string, parent: string): boolean {
  const candidate = normalizeProjectPath(path)
  const root = normalizeProjectPath(parent)
  return candidate === root || candidate.startsWith(root.endsWith('/') ? root : `${root}/`)
}
