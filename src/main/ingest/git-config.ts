import { isAbsolute, resolve, win32 } from 'path'

// Both a worktree's `.git` file (`gitdir: <path>`) and git's own `worktrees/<name>/gitdir` (bare
// path) point somewhere; `worktree.useRelativePaths` makes either relative to the file's folder.
// Git writes `C:/…` on Windows, which only win32 recognizes as absolute, and posix `resolve`
// would collapse a UNC `//server` prefix, so absolute pointers are returned as written.
export function resolveGitPath(
  pointer: string,
  fileDir: string,
  platform: NodeJS.Platform
): string | null {
  if (!pointer || pointer.includes('\0') || (platform === 'win32' && /^\/(?!\/)/.test(pointer)))
    return null
  return isAbsolute(pointer) || win32.isAbsolute(pointer) ? pointer : resolve(fileDir, pointer)
}

export function parseGitdir(
  content: string,
  fileDir: string,
  platform = process.platform
): string | null {
  return resolveGitPath(content.replace(/^gitdir:/, '').trim(), fileDir, platform)
}

const GIT_CONFIG_ESCAPES: Record<string, string> = {
  '\\': '\\',
  '"': '"',
  n: '\n',
  t: '\t',
  b: '\b'
}

function configValue(raw: string): string | undefined {
  let value = ''
  let end = 0
  let quoted = false
  for (let index = 0; index < raw.length; index++) {
    const char = raw[index]
    if (char === '"') quoted = !quoted
    else if (!quoted && (char === '#' || char === ';')) break
    else if (char === '\\') {
      const escaped = GIT_CONFIG_ESCAPES[raw[++index]]
      if (escaped === undefined) return undefined
      value += escaped
      end = value.length
    } else {
      value += char
      if (quoted || !/\s/.test(char)) end = value.length
    }
  }
  return quoted ? undefined : value.slice(0, end)
}

export function gitBoolean(raw: string | true | undefined): boolean {
  if (raw === true) return true
  const value = raw?.trim().toLowerCase() ?? ''
  if (['true', 'yes', 'on'].includes(value)) return true
  return /^[+-]?\d+$/.test(value) && /[1-9]/.test(value)
}

// Only the `core` and `extensions` sections, keyed `section.name` in lower case; a bare key is `true`.
// shortcut: include/includeIf are ignored; resolve permitted includes if real layouts need them.
export function parseGitConfig(config: string): Map<string, string | true> {
  const values = new Map<string, string | true>()
  let section = ''
  for (let line of config.replace(/(^|[^\\])((?:\\\\)*)\\\r?\n/g, '$1$2').split(/\r?\n/)) {
    const header = /^\s*\[([^\]]*)\](.*)$/.exec(line)
    if (header) {
      section = header[1].trim().toLowerCase()
      line = header[2]
    }
    const entry = /^\s*([a-z][\w-]*)\s*(?:$|[#;]|=\s*(.*))/i.exec(line)
    if (!entry || (section !== 'core' && section !== 'extensions')) continue
    const value = entry[2] === undefined ? true : configValue(entry[2])
    if (value !== undefined) values.set(section + '.' + entry[1].toLowerCase(), value)
  }
  return values
}
