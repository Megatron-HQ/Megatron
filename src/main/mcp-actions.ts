import { isAbsolute } from 'path'
import { MAX_MCP_SERVER_ID_LENGTH, type McpDeclarationRef } from '../shared/ipc'
import { runClaude, type RunClaudeResult } from './claude-process'

// MCP actions run only through Claude Code's own `claude mcp` commands (docs/mcp-servers.md,
// Writes); Megatron never edits .claude.json or .mcp.json itself.

const COMMAND_TIMEOUT_MS = 300_000
const COMMAND_TIMEOUT_MESSAGE =
  'Claude Code did not finish within 5 minutes. Check your connection and try again.'
const ACTION_IN_PROGRESS_MESSAGE = 'Another MCP action is already running. Wait for it to finish.'
const LAUNCH_FAILED_MESSAGE = 'Could not launch Claude Code. Try again.'
const CONFIGURED_SCOPES = new Set(['local', 'project', 'user'])

export const MCP_RESET_ARGS = ['mcp', 'reset-project-choices']

// `--` ends the options: names are free text, and one starting with `-` would read as a flag.
export function mcpRemoveArgs(name: string, scope: McpDeclarationRef['scope']): string[] {
  return ['mcp', 'remove', '--scope', scope, '--', name]
}

export function mcpLogoutArgs(name: string): string[] {
  return ['mcp', 'logout', '--', name]
}

export function isMcpDeclarationRef(input: unknown): input is McpDeclarationRef {
  if (typeof input !== 'object' || input === null) return false
  const value = input as Record<string, unknown>
  return (
    typeof value.serverId === 'string' &&
    value.serverId.length > 0 &&
    value.serverId.length <= MAX_MCP_SERVER_ID_LENGTH &&
    !value.serverId.includes('\0') &&
    CONFIGURED_SCOPES.has(value.scope as string) &&
    (value.scope === 'user'
      ? value.projectPath === null
      : typeof value.projectPath === 'string' &&
        !value.projectPath.includes('\0') &&
        isAbsolute(value.projectPath))
  )
}

let running = false
const idleWaiters: (() => void)[] = []

// A relaunch onto another Claude Code folder waits here, so it never kills a CLI mid-write.
export function mcpActionsIdle(): Promise<void> {
  if (!running) return Promise.resolve()
  return new Promise((resolve) => idleWaiters.push(resolve))
}

// One at a time across every server: each command can rewrite the same .claude.json.
export async function runMcpAction(
  args: string[],
  cwd: string,
  stdin?: string
): Promise<RunClaudeResult> {
  if (running) return { ok: false, error: ACTION_IN_PROGRESS_MESSAGE }
  running = true
  try {
    return await runClaude(args, {
      cwd,
      timeoutMs: COMMAND_TIMEOUT_MS,
      timeoutMessage: COMMAND_TIMEOUT_MESSAGE,
      ...(stdin === undefined ? {} : { stdin })
    })
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : LAUNCH_FAILED_MESSAGE }
  } finally {
    running = false
    for (const resolve of idleWaiters.splice(0)) resolve()
  }
}
