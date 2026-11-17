import { readdirSync, realpathSync } from 'fs'
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
    if (isTooBroad(canonical, homes)) return reject('invalid')
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
