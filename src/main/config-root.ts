import { readdirSync, realpathSync, statSync } from 'fs'
import { dirname, isAbsolute, join, resolve } from 'path'
import { defaultConfigRoot, isWithinGrant, type ConfigRoot } from './permissions'

export interface ConfigRootIssue {
  value: string
  // invalid: not an absolute local folder Megatron may read as a whole (relative, UNC, $HOME or an
  // ancestor, a drive root, a file, unreadable). missing: doesn't exist yet. no-marker: exists, but
  // Claude Code has never written to it. Only `missing` keeps the folder; the rest fall back to ~/.claude.
  reason: 'invalid' | 'missing' | 'no-marker'
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
// user named in CLAUDE_CONFIG_DIR, before that folder becomes Tier 1. See docs/security-hardening.md.
export function resolveConfigRoot(
  value: string | undefined,
  home: string
): { root: ConfigRoot; issue?: ConfigRootIssue } {
  const fallback = defaultConfigRoot(home)
  if (value === undefined || value.trim() === '') return { root: fallback }
  const reject = (
    reason: ConfigRootIssue['reason']
  ): { root: ConfigRoot; issue: ConfigRootIssue } => ({
    root: fallback,
    issue: { value, reason }
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
    source: 'environment'
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
      return { root, issue: { value, reason: 'missing' } }
    return reject('invalid')
  }
  return names.some((name) => CLAUDE_MARKERS.has(name)) ? { root } : reject('no-marker')
}
