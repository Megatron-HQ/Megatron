import { isAbsolute, join, resolve, sep } from 'path'
import type { ProjectFolder } from '../../shared/ipc'
import {
  allowedRealpathSync,
  allowedStatSync,
  getGrantedPaths,
  readAllowedDirectory
} from '../permissions'
import type { SkillRoot } from './skills-scanner'

const SKIP_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  'coverage',
  'vendor',
  'target',
  '.next',
  '.claude'
])
export const PROJECT_DISCOVERY_LIMITS = { maxDepth: 64, maxDirectories: 50_000 }

export function sanitizeProjectFolders(value: unknown): ProjectFolder[] {
  if (!Array.isArray(value)) return []
  return value
    .slice(0, PROJECT_DISCOVERY_LIMITS.maxDirectories)
    .filter(
      (entry): entry is ProjectFolder =>
        entry !== null &&
        typeof entry === 'object' &&
        typeof entry.path === 'string' &&
        isAbsolute(entry.path) &&
        ['folder', 'repository'].includes(entry.kind) &&
        ['available', 'unavailable', 'missing', 'needs_access'].includes(entry.status)
    )
}

function pathKey(path: string): string {
  const absolute = resolve(path)
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute
}

export function discoverProjects(
  grants: string[] = getGrantedPaths(),
  previous: ProjectFolder[] = [],
  limits = PROJECT_DISCOVERY_LIMITS
): { projects: ProjectFolder[]; skillRoots: SkillRoot[]; incomplete: boolean } {
  const projects = new Map<string, ProjectFolder>()
  const roots = new Map<string, SkillRoot>()
  const visited = new Set<string>()
  let incomplete = false
  const addRoot = (dir: string, projectRoot: string): void => {
    if (!roots.has(pathKey(dir)))
      roots.set(pathKey(dir), { dir, sourceType: 'project', projectRoot })
  }

  // Discover ancestors first so an overlapping package grant cannot replace its
  // repository owner merely because the user selected that folder earlier.
  for (const grant of [...grants].sort(
    (first, second) => pathKey(first).length - pathKey(second).length
  )) {
    let grantIncomplete = false
    const unavailable = (): void => {
      incomplete = true
      grantIncomplete = true
    }
    function walk(directoryPath: string, depth: number, owner?: string): void {
      if (depth > limits.maxDepth || visited.size >= limits.maxDirectories) {
        unavailable()
        return
      }
      const directory = readAllowedDirectory(directoryPath)
      const isGrant = pathKey(directoryPath) === pathKey(grant)
      if (directory.status !== 'ok') {
        if (directory.status === 'unavailable') unavailable()
        if (isGrant)
          projects.set(pathKey(grant), {
            path: grant,
            kind: 'folder',
            status: directory.status === 'missing' ? 'missing' : 'unavailable'
          })
        return
      }
      const canonical = allowedRealpathSync(directoryPath)
      if (canonical === null) {
        unavailable()
        return
      }
      const key = pathKey(canonical)
      if (visited.has(key)) {
        if (isGrant && !projects.has(key))
          projects.set(key, { path: canonical, kind: 'folder', status: 'available' })
        return
      }
      visited.add(key)

      const claude = directory.entries.includes('.claude')
        ? readAllowedDirectory(join(directoryPath, '.claude'))
        : { status: 'missing' as const, entries: [] }
      if (claude.status === 'unavailable') unavailable()
      const hasSkills =
        claude.entries.includes('skills') &&
        allowedStatSync(join(directoryPath, '.claude', 'skills'))?.isDirectory() === true
      const hasSettings = claude.entries.some(
        (name) => name === 'settings.json' || name === 'settings.local.json'
      )
      const isRepository =
        directory.entries.includes('.git') || (owner === undefined && (hasSkills || hasSettings))
      const owningProject = isRepository ? canonical : owner
      if (isRepository || isGrant)
        projects.set(key, {
          path: canonical,
          kind: isRepository ? 'repository' : 'folder',
          status: claude.status === 'unavailable' ? 'unavailable' : 'available'
        })
      if (isRepository) addRoot(join(directoryPath, '.claude', 'skills'), canonical)
      if (hasSkills) addRoot(join(directoryPath, '.claude', 'skills'), owningProject ?? grant)

      for (const name of directory.entries) {
        if (SKIP_DIRECTORIES.has(name)) continue
        const child = join(directoryPath, name)
        const stats = allowedStatSync(child)
        if (stats === null) {
          unavailable()
          continue
        }
        if (stats.isDirectory()) walk(child, depth + 1, owningProject)
      }
    }
    addRoot(join(grant, '.claude', 'skills'), grant)
    walk(grant, 0)
    if (grantIncomplete) {
      const root = roots.get(pathKey(join(grant, '.claude', 'skills')))
      if (root) root.discoveryIncomplete = true
      const folder = projects.get(pathKey(grant))
      if (folder && folder.status === 'available') folder.status = 'unavailable'
    }
  }

  // Cached discovery is never a permission grant. A revoked ancestor may still be
  // covered by another explicit grant; otherwise discard its catalog entry.
  for (const entry of sanitizeProjectFolders(previous)) {
    const key = pathKey(entry.path)
    const covered = grants.some(
      (grant) =>
        key === pathKey(grant) ||
        key.startsWith(pathKey(grant).endsWith(sep) ? pathKey(grant) : pathKey(grant) + sep)
    )
    if (!covered || (entry.kind === 'folder' && !grants.some((grant) => key === pathKey(grant))))
      continue
    const current = projects.get(key)
    if (current) {
      if (current.status !== 'available' && entry.kind === 'repository') current.kind = 'repository'
      continue
    }
    const directory = readAllowedDirectory(entry.path)
    const status =
      directory.status === 'missing'
        ? 'missing'
        : directory.status === 'unavailable' || incomplete
          ? 'unavailable'
          : 'available'
    projects.set(key, { path: entry.path, kind: entry.kind, status })
    if (entry.kind === 'repository') addRoot(join(entry.path, '.claude', 'skills'), entry.path)
  }
  return { projects: [...projects.values()], skillRoots: [...roots.values()], incomplete }
}
