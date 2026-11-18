import { readdirSync, realpathSync, statSync } from 'fs'
import { basename, dirname, isAbsolute, join, resolve } from 'path'
import { homedir } from 'os'
import type { ClaudeFolderIssue, ClaudeFolderOption, ClaudeFolderTag } from '../shared/ipc'
import {
  claudeConfig,
  defaultConfigRoot,
  isWithinGrant,
  namesConfigFolder,
  type ConfigRoot
} from './permissions'

export type ConfigRootIssue = ClaudeFolderIssue

export interface ConfigRootResolution {
  root: ConfigRoot
  issue?: ConfigRootIssue
}

export function configDirectoryKey(directory: string): string {
  return process.platform === 'win32' ? directory.toLowerCase() : directory
}

export function currentConfigDirectory(directory: string): string | null {
  try {
    return statSync(directory).isDirectory()
      ? configDirectoryKey(realpathSync.native(directory))
      : null
  } catch {
    return null
  }
}

// When a profile is offline, resolve the existing part of its path. A newly created child
// should have the same identity through a parent symlink, junction, or Windows short name.
export function expectedConfigDirectory(directory: string): string {
  const absolute = resolve(directory)
  const missing: string[] = []
  for (let current = absolute; ; current = dirname(current)) {
    try {
      return configDirectoryKey(join(realpathSync.native(current), ...missing))
    } catch {
      if (dirname(current) === current) return configDirectoryKey(absolute)
      missing.unshift(basename(current))
    }
  }
}

// Fixed startup capability, never an arbitrary renderer path. A present folder may legitimately
// lose its last marker when the user deletes skills; reconnect validation is stricter.
export function assertConfigRootAvailable(root: ConfigRoot = claudeConfig()): void {
  if (!namesConfigFolder(root)) return
  if (
    root.canonicalDirectory !== undefined &&
    currentConfigDirectory(root.directory) !== root.canonicalDirectory
  )
    throw new Error(`Claude Code folder is unavailable or has changed: ${root.directory}`)
  const { issue } = resolveConfigRoot(
    root.directory,
    homedir(),
    root.source === 'environment' ? 'environment' : 'settings'
  )
  if (issue && issue.reason !== 'no-marker')
    throw new Error(`Claude Code folder is unavailable: ${root.directory} (${issue.reason})`)
}

const CLAUDE_MARKERS = new Set([
  'settings.json',
  '.claude.json',
  'projects',
  'plugins',
  'skills',
  'history.jsonl'
])

function isTooBroad(path: string, homes: string[]): boolean {
  return (
    path.startsWith('\\\\') ||
    dirname(path) === path ||
    homes.some((home) => isWithinGrant(home, path))
  )
}

// Spelling can't prove a folder isn't home: the default macOS and Windows disks ignore case, Windows
// has 8.3 short names, and fs.realpathSync fixes neither. File identity can, so it backs up
// isTooBroad and only ever adds a rejection. realpathSync.native would fix the spelling, but on
// Windows it turns a mapped drive into a UNC path, which isTooBroad then refuses.
function isHomeOrAncestor(path: string, homes: string[]): boolean {
  const { dev, ino } = statSync(path, { bigint: true })
  // A filesystem without file IDs reports 0; the string checks still stand.
  if (ino === 0n) return false
  return homes.some((home) => {
    for (let current = home; ; current = dirname(current)) {
      try {
        const ancestor = statSync(current, { bigint: true })
        if (ancestor.dev === dev && ancestor.ino === ino) return true
      } catch {
        /* An unreadable ancestor can't match. */
      }
      if (dirname(current) === current) return false
    }
  })
}

// The marker probe is its own capability, like CLI discovery: it lists names in the one folder the
// user named (in CLAUDE_CONFIG_DIR or Settings), before that folder becomes Tier 1. See
// docs/security-hardening.md.
export function resolveConfigRoot(
  value: string | undefined,
  home: string,
  source: ConfigRootIssue['source'] = 'environment'
): ConfigRootResolution {
  const fallback = defaultConfigRoot(home)
  if (value === undefined || value.trim() === '') return { root: fallback }
  const reject = (reason: ConfigRootIssue['reason']): Required<ConfigRootResolution> => ({
    root: fallback,
    issue: { value, reason, source }
  })
  const homes = [resolve(home)]
  try {
    homes.push(realpathSync(home))
  } catch {
    /* The given form still guards an unreadable home. */
  }
  // Claude Code itself reads `CLAUDE_CONFIG_DIR.normalize('NFC')`, so the paths it records in
  // installed_plugins.json and transcripts match this form lexically.
  const directory = resolve(value.normalize('NFC'))
  if (!isAbsolute(value) || isTooBroad(directory, homes)) return reject('invalid')
  const root: ConfigRoot = {
    directory,
    claudeJson: join(directory, '.claude.json'),
    source
  }
  let names: string[]
  try {
    const canonical = realpathSync(directory)
    if (isTooBroad(canonical, homes) || isHomeOrAncestor(canonical, homes)) return reject('invalid')
    names = readdirSync(canonical)
  } catch (error) {
    // Held rather than swapped for ~/.claude: the user named this folder, and reading another
    // profile's data in its place would be silently wrong.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT')
      return { root, issue: { value, reason: 'missing', source } }
    return reject('invalid')
  }
  return names.some((name) => CLAUDE_MARKERS.has(name)) ? { root } : reject('no-marker')
}

// `saved` is the Settings choice: a path, null for Claude Code's default, undefined if never made.
export function activeConfigRoot(
  { saved, environment }: { saved: string | null | undefined; environment: string | undefined },
  home: string
): ConfigRootResolution {
  // null means ~/.claude read exactly as Claude Code reads it with no variable (.claude.json in
  // $HOME), even when CLAUDE_CONFIG_DIR is set: "Use default" has to escape a bad variable too.
  if (saved === null) return { root: { ...defaultConfigRoot(home), source: 'settings' } }
  if (saved === undefined) return resolveConfigRoot(environment, home)
  const chosen = resolveConfigRoot(saved, home, 'settings')
  if (!chosen.issue || chosen.issue.reason === 'missing') return chosen
  return { root: resolveConfigRoot(environment, home).root, issue: chosen.issue }
}

// Saved as given, never as its real path, just as CLAUDE_CONFIG_DIR is kept: a link the user
// repoints later is followed, and the safety checks resolve it again on every launch. Unless chosen
// as `named` (.claude.json inside, as when CLAUDE_CONFIG_DIR names it), ~/.claude saves null.
export function settingsChoice(
  path: string,
  home: string,
  named = false
): string | null | { reason: ConfigRootIssue['reason'] } {
  if (!named && sameFolder(path, defaultConfigRoot(home).directory)) return null
  const { root, issue } = resolveConfigRoot(path, home, 'settings')
  return issue ? { reason: issue.reason } : root.directory
}

export function sameFolder(a: string, b: string): boolean {
  try {
    const first = statSync(a, { bigint: true })
    const second = statSync(b, { bigint: true })
    // A filesystem without file IDs reports 0; only the paths can be compared there.
    if (first.ino !== 0n && second.ino !== 0n)
      return first.dev === second.dev && first.ino === second.ino
  } catch {
    /* A missing folder can only be compared by path. */
  }
  const key = (path: string): string => {
    const resolved = resolve(path.normalize('NFC'))
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved
  }
  return key(a) === key(b)
}

// `.claude-*`/`.claude_*` is how people name profiles for CLAUDE_CONFIG_DIR aliases. Only names are
// read: home's entries, then each candidate's, never a file's contents.
const PROFILE_NAME = /^\.claude[-_]/i
const PROFILE_MARKERS = new Set(['settings.json', '.claude.json', 'projects'])

function entryNames(directory: string): string[] {
  try {
    return readdirSync(directory)
  } catch {
    return []
  }
}

function homeProfiles(home: string): string[] {
  return entryNames(home)
    .filter(
      (name) =>
        PROFILE_NAME.test(name) &&
        entryNames(join(home, name)).some((entry) => PROFILE_MARKERS.has(entry))
    )
    .sort()
}

// An option is a folder read one way: ~/.claude named (.claude.json inside, as CLAUDE_CONFIG_DIR
// reads it) is a different option from ~/.claude as the default (~/.claude.json). Only the
// default option is unnamed; every other path is saved and read as a named folder.
export function listConfigFolders(
  {
    saved,
    environment,
    active
  }: { saved: string | null | undefined; environment: string | undefined; active: ConfigRoot },
  home: string
): ClaudeFolderOption[] {
  const claude = defaultConfigRoot(home).directory
  const candidates: { id: string; path: string; tags: ClaudeFolderTag[]; named: boolean }[] = []
  if (typeof saved === 'string')
    candidates.push({ id: 'saved', path: saved, tags: [], named: true })
  candidates.push({ id: 'default', path: claude, tags: ['default'], named: false })
  // Claude Code writes .claude.json into ~/.claude only when CLAUDE_CONFIG_DIR names it, so this
  // offers that form to an app launched from Finder or the Dock, without the variable.
  if (entryNames(claude).includes('.claude.json'))
    candidates.push({ id: 'named', path: claude, tags: [], named: true })
  if (environment !== undefined && isAbsolute(environment))
    candidates.push({
      id: 'environment',
      path: resolve(environment.normalize('NFC')),
      tags: ['environment'],
      named: true
    })
  for (const name of homeProfiles(home))
    candidates.push({ id: `home:${name}`, path: join(home, name), tags: [], named: true })
  const activeNamed = namesConfigFolder(active)
  const options: (ClaudeFolderOption & { named: boolean })[] = []
  for (const candidate of candidates) {
    const match = options.find(
      (option) => option.named === candidate.named && sameFolder(option.path, candidate.path)
    )
    if (match) match.tags = [...new Set([...match.tags, ...candidate.tags])]
    else
      options.push({
        ...candidate,
        active: candidate.named === activeNamed && sameFolder(candidate.path, active.directory)
      })
  }
  return options.map(({ named, ...option }) => ({
    ...option,
    tags: named && sameFolder(option.path, claude) ? [...option.tags, 'named'] : option.tags
  }))
}
