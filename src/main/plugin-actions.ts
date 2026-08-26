import { execFile } from 'child_process'
import type { PluginActionInput, PluginActionResult } from '../shared/ipc'

const CLAUDE_NOT_FOUND_MESSAGE =
  'Claude Code CLI was not found. Install Claude Code and ensure `claude` is on your PATH.'
const COMMAND_TIMEOUT_MESSAGE =
  'Claude Code did not finish within 5 minutes. Check your connection and try again.'
const UNSAFE_PLUGIN_DETAILS_MESSAGE =
  'Plugin details contain unsupported characters. Refresh the plugin list and try again.'
const WINDOWS_SHELL_META_CHARACTERS = new Set(['"', '%', '&', '|', '<', '>', '(', ')', '^', '!'])
const ACTION_IN_PROGRESS_MESSAGE =
  'Another action is already running for this plugin. Wait for it to finish.'

const claudeOptions = {
  shell: process.platform === 'win32',
  timeout: 300_000,
  windowsHide: true
}
const runningPluginActions = new Set<string>()

function actionError(
  error: Error & { code?: string | number | null; killed?: boolean },
  stderr: string
): string {
  if (
    error.code === 'ENOENT' ||
    /not recognized as an internal command|command not found/i.test(stderr)
  ) {
    return CLAUDE_NOT_FOUND_MESSAGE
  }
  if (error.killed) return COMMAND_TIMEOUT_MESSAGE
  return stderr || error.message
}

function runClaudePlugin(args: string[]): Promise<PluginActionResult> {
  return new Promise((resolve) => {
    execFile('claude', args, claudeOptions, (error, _stdout, stderr) => {
      resolve(error ? { ok: false, stderr: actionError(error, stderr) } : { ok: true })
    })
  })
}

// Always disambiguated as `name@marketplace` and passed an explicit --scope from the
// plugin_registry row — the CLI's own cwd-based auto-detect defaults uninstall/update to
// "user" scope when omitted, which is wrong for a project-scoped install.
function pluginId(input: PluginActionInput): string | null {
  if (input.scope !== 'user' && input.scope !== 'project') {
    return null
  }
  if (
    hasWindowsShellControlCharacter(input.name) ||
    hasWindowsShellControlCharacter(input.marketplace)
  ) {
    return null
  }
  return `${input.name}@${input.marketplace}`
}

function hasWindowsShellControlCharacter(value: string): boolean {
  return [...value].some(
    (character) => character.codePointAt(0)! < 32 || WINDOWS_SHELL_META_CHARACTERS.has(character)
  )
}

function runPluginAction(
  input: PluginActionInput,
  verb: 'enable' | 'disable' | 'update' | 'uninstall'
): Promise<PluginActionResult> {
  const id = pluginId(input)
  if (!id) return Promise.resolve({ ok: false, stderr: UNSAFE_PLUGIN_DETAILS_MESSAGE })
  if (runningPluginActions.has(id)) {
    return Promise.resolve({ ok: false, stderr: ACTION_IN_PROGRESS_MESSAGE })
  }

  const args = ['plugin', verb, id, '--scope', input.scope]
  if (verb === 'update' || verb === 'uninstall') args.push('-y')
  runningPluginActions.add(id)
  return runClaudePlugin(args).finally(() => runningPluginActions.delete(id))
}

export function enablePlugin(input: PluginActionInput): Promise<PluginActionResult> {
  return runPluginAction(input, 'enable')
}

export function disablePlugin(input: PluginActionInput): Promise<PluginActionResult> {
  return runPluginAction(input, 'disable')
}

// -y: Megatron invokes this from a GUI, never a TTY, and the CLI requires -y in that case.
export function updatePlugin(input: PluginActionInput): Promise<PluginActionResult> {
  return runPluginAction(input, 'update')
}

export function uninstallPlugin(input: PluginActionInput): Promise<PluginActionResult> {
  return runPluginAction(input, 'uninstall')
}
