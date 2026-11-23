import { posix, win32 } from 'path'
import type { ClaudeCommand } from './claude-cli'

// Signing in to an MCP server (#50, docs/mcp-servers.md, Signing in to a server). `claude mcp
// login` refuses to run without an interactive terminal, and Megatron's runner pipes its streams,
// so Megatron opens a terminal window that runs Claude Code's own login there. Tokens stay with
// Claude Code; Megatron only reads the result back with `claude mcp get`.

type CommandLine = Pick<ClaudeCommand, 'executable' | 'prefixArguments'>

export type LoginTerminalResult = { ok: true } | { ok: false; error: string }

const SCRIPT_PREFIX = 'megatron-mcp-login-'
const MACOS_OPEN = '/usr/bin/open'
const DONE_NOTE =
  'Megatron: when you have finished signing in, close this window and click Check sign-in.'

// `--` ends the options: a name may start with `-`.
export function mcpLoginArgs(name: string): string[] {
  return ['mcp', 'login', '--', name]
}

function manualCommand(name: string): string {
  return `claude mcp login -- "${name}"`
}

// PowerShell single-quoted strings are literal; a quote inside is doubled.
function powershellQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

// POSIX shell single-quoted strings are literal; a quote inside closes, escapes and reopens.
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

function commandWords(command: CommandLine, name: string): string[] {
  return [command.executable, ...command.prefixArguments, ...mcpLoginArgs(name)]
}

function encodePowershell(script: string): string {
  return Buffer.from(script, 'utf16le').toString('base64')
}

// A detached Node spawn has no console standard handles on Windows. Start-Process gives the login
// a new console. Both PowerShell processes use the absolute System32 path and encoded scripts.
export function windowsLoginLaunch(
  command: CommandLine,
  name: string,
  systemRoot: string
): { file: string; args: string[] } {
  const file = win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const [executable, ...args] = commandWords(command, name).map(powershellQuote)
  const loginScript = [
    `& ${executable} ${args.join(' ')}`,
    `Write-Host ''`,
    `Write-Host ${powershellQuote(DONE_NOTE)}`
  ].join('\n')
  const terminalArgs = ['-NoProfile', '-NoExit', '-EncodedCommand', encodePowershell(loginScript)]
    .map(powershellQuote)
    .join(', ')
  const launchScript = `Start-Process -FilePath ${powershellQuote(file)} -ArgumentList @(${terminalArgs}) -WorkingDirectory $PWD.ProviderPath -WindowStyle Normal -ErrorAction Stop`
  return {
    file,
    args: ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodePowershell(launchScript)]
  }
}

// A one-shot script Terminal runs in the user's own shell, which carries none of Megatron's
// environment: the Claude Code folder is set (or cleared) explicitly so the login reaches the same
// folder Megatron reads, whatever the shell profile says.
export function macosLoginScript(
  command: CommandLine,
  name: string,
  cwd: string,
  configDirectory: string | undefined
): string {
  return [
    '#!/bin/sh',
    'rm -f -- "$0"',
    `cd -- ${shellQuote(cwd)} || exit 1`,
    configDirectory === undefined
      ? 'unset CLAUDE_CONFIG_DIR'
      : `export CLAUDE_CONFIG_DIR=${shellQuote(configDirectory)}`,
    commandWords(command, name).map(shellQuote).join(' '),
    'echo',
    `echo ${shellQuote(DONE_NOTE)}`,
    ''
  ].join('\n')
}

interface SpawnedChild {
  once(event: 'spawn' | 'error', listener: () => void): unknown
  once(event: 'exit', listener: (code: number | null) => void): unknown
  unref: () => void
}

export interface LoginTerminalDependencies {
  platform: NodeJS.Platform
  command: ClaudeCommand
  systemRoot: string
  // Megatron's private data folder; the macOS script lives there until Terminal runs it.
  scriptFolder: string
  spawn: (
    file: string,
    args: string[],
    options: {
      cwd?: string
      env?: NodeJS.ProcessEnv
      detached: boolean
      stdio: 'ignore'
      windowsHide: boolean
    }
  ) => SpawnedChild
  writeFile: (path: string, text: string, mode: number) => void
  randomName: () => string
}

function terminalLaunched(child: SpawnedChild, platform: NodeJS.Platform): Promise<boolean> {
  return new Promise((resolve) => {
    child.once('error', () => resolve(false))
    if (platform === 'win32') {
      child.once('exit', (code) => resolve(code === 0))
    } else {
      child.once('spawn', () => resolve(true))
    }
  })
}

export async function openLoginTerminal(
  name: string,
  cwd: string,
  deps: LoginTerminalDependencies
): Promise<LoginTerminalResult> {
  const fallback = `Megatron couldn't open a terminal. Run ${manualCommand(name)} in a terminal in ${cwd} instead.`
  let child: SpawnedChild
  try {
    if (deps.platform === 'win32') {
      const launch = windowsLoginLaunch(deps.command, name, deps.systemRoot)
      child = deps.spawn(launch.file, launch.args, {
        detached: false,
        stdio: 'ignore',
        windowsHide: true,
        cwd,
        env: deps.command.environment
      })
    } else if (deps.platform === 'darwin') {
      const script = posix.join(deps.scriptFolder, `${SCRIPT_PREFIX}${deps.randomName()}.command`)
      deps.writeFile(
        script,
        macosLoginScript(deps.command, name, cwd, deps.command.environment.CLAUDE_CONFIG_DIR),
        0o700
      )
      child = deps.spawn(MACOS_OPEN, ['-a', 'Terminal', script], {
        detached: true,
        stdio: 'ignore',
        windowsHide: false
      })
    } else {
      return {
        ok: false,
        error: `Signing in from Megatron needs Windows or macOS. Run ${manualCommand(name)} in a terminal in ${cwd}.`
      }
    }
  } catch {
    return { ok: false, error: fallback }
  }
  if (!(await terminalLaunched(child, deps.platform))) return { ok: false, error: fallback }
  child.unref()
  return { ok: true }
}
