import { posix, win32 } from 'path'
import type { ExecutableStatus } from './permissions'

// Whether a stdio MCP server's bare command can be found on PATH (the mcp-command-not-found lint,
// docs/mcp-servers.md). Megatron can only see its own PATH, not the shell's `claude` runs in, so
// every doubt answers 'unknown' and the lint stays silent: a missing finding costs less than a
// false one.
export type CommandLookup = 'found' | 'missing' | 'unknown'

interface CommandLookupOptions {
  environment: NodeJS.ProcessEnv
  platform: NodeJS.Platform
  // One stat per candidate (executableStatusSync); injected so both platforms are testable.
  statusOf: (candidate: string) => ExecutableStatus
}

const WINDOWS_DEFAULT_PATHEXT = ['.com', '.exe', '.bat', '.cmd']
// What launchd hands an app opened from the Dock or Finder. A PATH holding nothing else carries
// none of the user's shell setup (Homebrew, nvm, uv), so a lookup on it would be wrong.
const MACOS_LAUNCHD_PATH = new Set(['/usr/bin', '/bin', '/usr/sbin', '/sbin'])

function environmentValue(environment: NodeJS.ProcessEnv, key: string): string | undefined {
  const name = Object.keys(environment).find((candidate) => candidate.toUpperCase() === key)
  return name === undefined ? undefined : environment[name]
}

function searchFolders(environment: NodeJS.ProcessEnv, platform: NodeJS.Platform): string[] {
  const paths = platform === 'win32' ? win32 : posix
  return (environmentValue(environment, 'PATH') ?? '')
    .split(platform === 'win32' ? ';' : ':')
    .map((entry) => (platform === 'win32' ? entry.trim().replace(/^"(.*)"$/, '$1') : entry))
    .filter((entry) => entry !== '' && paths.isAbsolute(entry))
}

function pathReflectsShell(folders: string[], platform: NodeJS.Platform): boolean {
  if (platform !== 'darwin') return true
  return folders.some((folder) => !MACOS_LAUNCHD_PATH.has(folder.replace(/\/+$/, '')))
}

function candidateNames(
  program: string,
  environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform
): string[] {
  if (platform !== 'win32') return [program]
  const configured = (environmentValue(environment, 'PATHEXT') ?? '')
    .split(';')
    .map((extension) => extension.trim().toLowerCase())
    .filter((extension) => extension.startsWith('.'))
  const extensions = configured.length > 0 ? configured : WINDOWS_DEFAULT_PATHEXT
  const own = win32.extname(program).toLowerCase()
  return extensions.includes(own) ? [program] : extensions.map((extension) => program + extension)
}

export function createCommandLookup(
  options: CommandLookupOptions
): (program: string) => CommandLookup {
  const { environment, platform, statusOf } = options
  const paths = platform === 'win32' ? win32 : posix
  const folders = searchFolders(environment, platform)
  const trusted = folders.length > 0 && pathReflectsShell(folders, platform)
  const answers = new Map<string, CommandLookup>()

  function lookUp(program: string): CommandLookup {
    if (!trusted) return 'unknown'
    let doubtful = false
    for (const folder of folders) {
      for (const name of candidateNames(program, environment, platform)) {
        const status = statusOf(paths.join(folder, name))
        if (status === 'present') return 'found'
        if (status === 'unknown') doubtful = true
      }
    }
    return doubtful ? 'unknown' : 'missing'
  }

  return (program) => {
    let answer = answers.get(program)
    if (answer === undefined) {
      answer = lookUp(program)
      answers.set(program, answer)
    }
    return answer
  }
}
