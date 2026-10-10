import { homedir } from 'os'
import { basename, delimiter, dirname, isAbsolute, join, resolve, sep } from 'path'
import { inspectCliCandidate, inspectCliDirectory } from './permissions'

export interface ClaudeCommand {
  executable: string
  prefixArguments: string[]
  environment: NodeJS.ProcessEnv
}

function environmentValue(environment: NodeJS.ProcessEnv, key: string): string | undefined {
  const name = Object.keys(environment).find((name) => name.toUpperCase() === key)
  return name === undefined ? undefined : environment[name]
}

function isWithin(candidate: string, directory: string): boolean {
  const normalize = (value: string): string =>
    process.platform === 'win32' ? resolve(value).toLowerCase() : resolve(value)
  const full = normalize(candidate)
  const root = normalize(directory)
  return full === root || full.startsWith(root + sep)
}

export function resolveClaudeCommand(projectDirectory?: string): ClaudeCommand | null {
  const excluded = projectDirectory === undefined ? [] : [projectDirectory]
  const environment = { ...process.env }
  const directories = (environmentValue(environment, 'PATH') ?? '')
    .split(delimiter)
    .map((entry) => entry.replace(/^"|"$/g, ''))
    .filter(
      (entry) =>
        isAbsolute(entry) &&
        resolve(entry) !== resolve(process.cwd()) &&
        !entry.startsWith('\\\\') &&
        !excluded.some((directory) => isWithin(entry, directory))
    )
    .map((entry) => inspectCliDirectory(entry, excluded))
    .filter((entry): entry is string => entry !== null)
  for (const name of Object.keys(environment)) {
    if (
      ['PATH', 'NODE_OPTIONS', 'NODE_PATH', 'NODE_EXTRA_CA_CERTS', 'ELECTRON_RUN_AS_NODE'].includes(
        name.toUpperCase()
      )
    )
      delete environment[name]
  }
  environment.PATH = directories.join(delimiter)
  const candidates = [...new Set([...directories, join(homedir(), '.local', 'bin')])]
  const inspect = (candidate: string): string | null => inspectCliCandidate(candidate, excluded)
  const node = directories
    .map((directory) =>
      inspect(join(directory, process.platform === 'win32' ? 'node.exe' : 'node'))
    )
    .find((candidate): candidate is string => candidate !== null)
  for (const directory of candidates) {
    const native = inspect(join(directory, process.platform === 'win32' ? 'claude.exe' : 'claude'))
    if (native !== null) {
      if (basename(native) === 'cli.js') {
        if (node !== undefined && native.endsWith(join('@anthropic-ai', 'claude-code', 'cli.js')))
          return { executable: node, prefixArguments: [native], environment }
      } else return { executable: native, prefixArguments: [], environment }
    }
    if (node === undefined) continue
    const npmEntries = [
      join(directory, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js'),
      join(dirname(directory), 'lib', 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js')
    ]
    for (const entry of npmEntries) {
      const canonical = inspect(entry)
      if (canonical !== null && canonical.endsWith(join('@anthropic-ai', 'claude-code', 'cli.js')))
        return { executable: node, prefixArguments: [canonical], environment }
    }
  }
  return null
}
