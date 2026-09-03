import { execFile } from 'child_process'
import { isPathAllowed } from './permissions'
import type { PluginActionInput, PluginActionResult } from '../shared/ipc'

const CLAUDE_NOT_FOUND_MESSAGE =
  'Claude Code CLI was not found. Install Claude Code and ensure `claude` is on your PATH.'
const COMMAND_TIMEOUT_MESSAGE =
  'Claude Code did not finish within 5 minutes. Check your connection and try again.'
const UNSAFE_PLUGIN_DETAILS_MESSAGE =
  'Plugin details contain unsupported characters. Refresh the plugin list and try again.'
const MISSING_PROJECT_PATH_MESSAGE =
  "This install doesn't record which project it belongs to, so Megatron can't tell the Claude " +
  'Code CLI where to run.'
const UNGRANTED_PROJECT_MESSAGE =
  "Grant this plugin's project folder in Manage Folders before changing it, so Megatron can " +
  'read the result.'
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

function runClaudePlugin(args: string[], cwd?: string): Promise<PluginActionResult> {
  // cwd is an execFile option, not part of the command line, so it never reaches the cmd.exe
  // parsing that `shell: true` enables on Windows — the metacharacter check below guards only
  // the arguments that do.
  const options = cwd === undefined ? claudeOptions : { ...claudeOptions, cwd }
  return new Promise((resolve) => {
    execFile('claude', args, options, (error, _stdout, stderr) => {
      resolve(error ? { ok: false, stderr: actionError(error, stderr) } : { ok: true })
    })
  })
}

// Always disambiguated as `name@marketplace` and passed an explicit --scope from the
// plugin_registry row — the CLI's own cwd-based auto-detect defaults uninstall/update to
// "user" scope when omitted, which is wrong for any other scope.
function pluginId(input: PluginActionInput): string | null {
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

// The CLI resolves a project/local install entirely from its working directory — `claude plugin
// list` run inside a project reports its plugins enabled, the identical command run from $HOME
// reports them disabled. So a project/local action needs the owning project as cwd; a user-scope
// action deliberately gets none, and inherits Megatron's own.
function actionCwd(input: PluginActionInput): { cwd?: string } | { error: string } {
  if (input.scope === 'user') return {}
  if (input.projectPath === null) return { error: MISSING_PROJECT_PATH_MESSAGE }
  // Requiring the grant is not just permission-model consistency: without it the project's
  // settings are unreadable, so the UI is showing Unknown, and Enable/Disable would be toggling
  // a switch whose current position Megatron just admitted it can't see.
  if (!isPathAllowed(input.projectPath)) return { error: UNGRANTED_PROJECT_MESSAGE }
  return { cwd: input.projectPath }
}

function runPluginAction(
  input: PluginActionInput,
  verb: 'enable' | 'disable' | 'update' | 'uninstall'
): Promise<PluginActionResult> {
  const resolved = actionCwd(input)
  if ('error' in resolved) return Promise.resolve({ ok: false, stderr: resolved.error })

  const id = pluginId(input)
  if (!id) return Promise.resolve({ ok: false, stderr: UNSAFE_PLUGIN_DETAILS_MESSAGE })

  // Keyed on the install, not the plugin identity: a user install and a project install of one
  // plugin are independent switches, as are two projects installing the same plugin.
  const actionKey = `${id}\u0000${input.scope}\u0000${input.projectPath ?? ''}`
  if (runningPluginActions.has(actionKey)) {
    return Promise.resolve({ ok: false, stderr: ACTION_IN_PROGRESS_MESSAGE })
  }

  const args = ['plugin', verb, id, '--scope', input.scope]
  if (verb === 'update' || verb === 'uninstall') args.push('-y')
  runningPluginActions.add(actionKey)
  return runClaudePlugin(args, resolved.cwd).finally(() => runningPluginActions.delete(actionKey))
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
