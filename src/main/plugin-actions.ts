import { execFile } from 'child_process'
import type { PluginActionInput, PluginActionResult } from '../shared/ipc'

function runClaudePlugin(args: string[]): Promise<PluginActionResult> {
  return new Promise((resolve) => {
    execFile('claude', args, (error, _stdout, stderr) => {
      resolve(error ? { ok: false, stderr: stderr || error.message } : { ok: true })
    })
  })
}

// Always disambiguated as `name@marketplace` and passed an explicit --scope from the
// plugin_registry row — the CLI's own cwd-based auto-detect defaults uninstall/update to
// "user" scope when omitted, which is wrong for a project-scoped install.
function pluginId(input: PluginActionInput): string {
  return `${input.name}@${input.marketplace}`
}

export function enablePlugin(input: PluginActionInput): Promise<PluginActionResult> {
  return runClaudePlugin(['plugin', 'enable', pluginId(input), '--scope', input.scope])
}

export function disablePlugin(input: PluginActionInput): Promise<PluginActionResult> {
  return runClaudePlugin(['plugin', 'disable', pluginId(input), '--scope', input.scope])
}

// -y: Megatron invokes this from a GUI, never a TTY, and the CLI requires -y in that case.
export function updatePlugin(input: PluginActionInput): Promise<PluginActionResult> {
  return runClaudePlugin(['plugin', 'update', pluginId(input), '--scope', input.scope, '-y'])
}

export function uninstallPlugin(input: PluginActionInput): Promise<PluginActionResult> {
  return runClaudePlugin(['plugin', 'uninstall', pluginId(input), '--scope', input.scope, '-y'])
}
