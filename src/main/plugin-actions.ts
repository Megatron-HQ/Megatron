import { isAbsolute } from 'path'
import { allowedStatSync, isPathAllowed } from './permissions'
import type { PluginActionInput, PluginActionResult, PluginUpdatePhase } from '../shared/ipc'
import { missingProjectInstallMessage } from '../shared/missing-project'
import { runClaude } from './claude-process'

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
const PLUGIN_IDENTIFIER_PATTERN = /^(?:@[a-zA-Z0-9][a-zA-Z0-9._-]*\/)?[a-zA-Z0-9][a-zA-Z0-9._-]*$/
const MARKETPLACE_IDENTIFIER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/
const MAX_IDENTIFIER_LENGTH = 200
const ACTION_IN_PROGRESS_MESSAGE =
  'Another action is already running for this plugin. Wait for it to finish.'

const runningPluginActions = new Set<string>()
const marketplaceRefreshes = new Map<string, Promise<PluginActionResult>>()

async function refreshMarketplace(marketplace: string, cwd?: string): Promise<PluginActionResult> {
  const key = JSON.stringify([marketplace, cwd ?? null])
  const active = marketplaceRefreshes.get(key)
  if (active) return active
  const refresh = runClaudePlugin(['plugin', 'marketplace', 'update', marketplace], cwd)
  marketplaceRefreshes.set(key, refresh)
  try {
    return await refresh
  } finally {
    marketplaceRefreshes.delete(key)
  }
}

async function runClaudePlugin(args: string[], cwd?: string): Promise<PluginActionResult> {
  const result = await runClaude(args, {
    cwd,
    timeoutMs: 300_000,
    timeoutMessage: COMMAND_TIMEOUT_MESSAGE
  })
  return result.ok ? { ok: true } : { ok: false, stderr: result.error }
}

// Always disambiguated as `name@marketplace` and passed an explicit --scope from the
// plugin_registry row — the CLI's own cwd-based auto-detect defaults uninstall/update to
// "user" scope when omitted, which is wrong for any other scope.
export function isPluginActionInput(input: unknown): input is PluginActionInput {
  if (typeof input !== 'object' || input === null) return false
  const value = input as Record<string, unknown>
  return (
    typeof value.name === 'string' &&
    value.name.length <= MAX_IDENTIFIER_LENGTH &&
    PLUGIN_IDENTIFIER_PATTERN.test(value.name) &&
    typeof value.marketplace === 'string' &&
    value.marketplace.length <= MAX_IDENTIFIER_LENGTH &&
    MARKETPLACE_IDENTIFIER_PATTERN.test(value.marketplace) &&
    ['user', 'project', 'local'].includes(value.scope as string) &&
    (value.projectPath === null ||
      (typeof value.projectPath === 'string' && isAbsolute(value.projectPath))) &&
    (value.scope !== 'user' || value.projectPath === null)
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
  if (!allowedStatSync(input.projectPath)?.isDirectory())
    return { error: missingProjectInstallMessage(input.projectPath) }
  return { cwd: input.projectPath }
}

async function runPluginAction(
  input: PluginActionInput,
  verb: 'enable' | 'disable' | 'update' | 'uninstall',
  onProgress?: (phase: PluginUpdatePhase) => void
): Promise<PluginActionResult> {
  if (!isPluginActionInput(input))
    return Promise.resolve({ ok: false, stderr: UNSAFE_PLUGIN_DETAILS_MESSAGE })
  const resolved = actionCwd(input)
  if ('error' in resolved) return Promise.resolve({ ok: false, stderr: resolved.error })

  const id = `${input.name}@${input.marketplace}`

  // Keyed on the install, not the plugin identity: a user install and a project install of one
  // plugin are independent switches, as are two projects installing the same plugin.
  const actionKey = `${id}\u0000${input.scope}\u0000${input.projectPath ?? ''}`
  if (runningPluginActions.has(actionKey)) {
    return Promise.resolve({ ok: false, stderr: ACTION_IN_PROGRESS_MESSAGE })
  }

  const args = ['plugin', verb, id, '--scope', input.scope]
  if (verb === 'update' || verb === 'uninstall') args.push('-y')
  runningPluginActions.add(actionKey)
  try {
    if (verb === 'update') {
      onProgress?.('marketplace')
      const refreshed = await refreshMarketplace(input.marketplace, resolved.cwd)
      if (!refreshed.ok) {
        return {
          ok: false,
          stderr: `Could not refresh marketplace ${input.marketplace}: ${refreshed.stderr ?? 'Unknown error'}`
        }
      }
    }
    if (verb === 'update') onProgress?.('install')
    return await runClaudePlugin(args, resolved.cwd)
  } catch (error) {
    return {
      ok: false,
      stderr: error instanceof Error ? error.message : 'Could not launch Claude Code. Try again.'
    }
  } finally {
    runningPluginActions.delete(actionKey)
  }
}

export function enablePlugin(input: PluginActionInput): Promise<PluginActionResult> {
  return runPluginAction(input, 'enable')
}

export function disablePlugin(input: PluginActionInput): Promise<PluginActionResult> {
  return runPluginAction(input, 'disable')
}

// -y: Megatron invokes this from a GUI, never a TTY, and the CLI requires -y in that case.
export function updatePlugin(
  input: PluginActionInput,
  onProgress?: (phase: PluginUpdatePhase) => void
): Promise<PluginActionResult> {
  return runPluginAction(input, 'update', onProgress)
}

export function uninstallPlugin(input: PluginActionInput): Promise<PluginActionResult> {
  return runPluginAction(input, 'uninstall')
}
