import type {
  McpActionResult,
  McpAddInput,
  McpAddResult,
  McpConfiguredScope,
  McpDeclarationRef,
  McpProjectApprovals,
  ScanSummary
} from '../shared/ipc'
import type { RunClaudeResult } from './claude-process'
import type { McpActionTarget, McpActionVerb, McpResetTarget } from './db/mcp-queries'
import { MCP_RESET_ARGS, mcpLogoutArgs, mcpRemoveArgs } from './mcp-actions'
import type { McpCheckFolder, McpServerCheck } from './mcp-status'
import type { CommandLookup } from './command-lookup'
import { mcpAddArgs, mcpAddRefusal, mcpServerConfig } from './mcp-add'
import { summarizeMcpServer } from './ingest/mcp-server-config'

// Each action is judged by the state it leaves, never the CLI's exit code: Claude Code refuses
// some requests with exit 0 (docs/mcp-servers.md, Connector logout and Writes).

type McpActionName = McpActionVerb | 'reset' | 'add'

export interface McpActionDependencies {
  target: (ref: McpDeclarationRef, verb: McpActionVerb) => McpActionTarget
  resetTarget: (projectPath: string) => McpResetTarget
  approvals: (projectPath: string) => McpProjectApprovals
  folder: (projectPath: string | null) => McpCheckFolder
  // stdin carries an added server's config, which may hold credentials, off the command line.
  run: (args: string[], cwd: string, stdin?: string) => Promise<RunClaudeResult>
  refresh: () => Promise<ScanSummary>
  serverStatus: (name: string, cwd: string) => Promise<McpServerCheck>
  forgetChecks: () => void
  reportError: (action: McpActionName, error: unknown) => void
  addConflict: (
    name: string,
    scope: McpConfiguredScope,
    projectPath: string | null
  ) => string | null
  findDeclaration: (
    name: string,
    scope: McpConfiguredScope,
    projectPath: string | null
  ) => { serverId: string; approval: 'approved' | 'rejected' | 'pending' | null } | null
  lookupCommand: (program: string) => CommandLookup
}

const SCOPE_LABELS: Record<McpConfiguredScope, string> = {
  local: 'local scope',
  project: "the project's .mcp.json",
  user: 'user scope'
}
const DECLARATIONS_SOURCE = 'scanMcpDeclarations'
// A folder the user hasn't granted, or that moved, is reported by every scan; it says nothing
// about the files this action changed.
const UNRELATED_ISSUES = new Set(['permission_required', 'project_missing'])
const UNREREAD_MESSAGE =
  "The command ran, but Megatron couldn't reread the MCP configuration to confirm it. Rescan to check."

function declarationsReread(summary: ScanSummary): boolean {
  const source = summary.sources.find((entry) => entry.name === DECLARATIONS_SOURCE)
  if (source?.status === 'complete') return true
  return (
    source?.status === 'partial' &&
    (source.issues ?? []).length > 0 &&
    (source.issues ?? []).every((issue) => UNRELATED_ISSUES.has(issue.code))
  )
}

// What a reset leaves: the choices it cleared now wait for approval, and a settings file's own
// approvals or rejections stay (docs/mcp-servers.md, Sources).
function resetMessage({ approved, pending, rejected }: McpProjectApprovals): string {
  const outcomes: [number, string, string][] = [
    [pending, 'waits for approval', 'wait for approval'],
    [approved, 'is still approved by a settings file', 'are still approved by a settings file'],
    [rejected, 'is still rejected by a settings file', 'are still rejected by a settings file']
  ]
  const parts = outcomes
    .filter(([amount]) => amount > 0)
    .map(([amount, one, many], index) => {
      const noun = index === 0 ? (amount === 1 ? ' server' : ' servers') : ''
      return `${amount}${noun} ${amount === 1 ? one : many}`
    })
  return parts.length === 0
    ? 'Reset the .mcp.json choices.'
    : `Reset the .mcp.json choices: ${parts.join(', ')}.`
}

const PENDING_APPROVAL_NOTE =
  " It waits for approval: Claude Code asks before using a server from a project's .mcp.json."

// A bare command Megatron can't find (mcp-command-not-found) is worth saying at once, since the
// server would otherwise fail on its first use.
function commandNote(
  input: McpAddInput,
  lookupCommand: (program: string) => CommandLookup
): string {
  const summary = summarizeMcpServer(mcpServerConfig(input))
  if (summary.commandIsBare !== true || summary.location === null) return ''
  return lookupCommand(summary.location) === 'missing'
    ? ` Megatron can't find ${summary.location} on PATH, so the server may not start until it's installed.`
    : ''
}

export function createMcpActionService(deps: McpActionDependencies): {
  remove: (ref: McpDeclarationRef) => Promise<McpActionResult>
  resetProjectChoices: (projectPath: string) => Promise<McpActionResult>
  logout: (ref: McpDeclarationRef) => Promise<McpActionResult>
  add: (input: McpAddInput) => Promise<McpAddResult>
} {
  async function reread(action: McpActionName): Promise<boolean> {
    try {
      return declarationsReread(await deps.refresh())
    } catch (error) {
      deps.reportError(action, error)
      return false
    }
  }

  return {
    async remove(ref) {
      const target = deps.target(ref, 'remove')
      if (!target.ok) return target
      const folder = deps.folder(target.projectPath)
      if (!folder.ok) return folder
      const run = await deps.run(mcpRemoveArgs(target.name, target.scope), folder.cwd)
      if (!run.ok) return run
      deps.forgetChecks()
      if (!(await reread('remove'))) return { ok: true, verificationError: UNREREAD_MESSAGE }
      const where = SCOPE_LABELS[target.scope]
      // A rename, or a project key spelled differently in .claude.json, can leave it in place.
      if (deps.target(ref, 'remove').ok)
        return {
          ok: true,
          verificationError: `Claude Code reported success, but ${target.name} is still declared in ${where}. Rescan to check, or run claude mcp remove in a terminal.`
        }
      return { ok: true, message: `Removed ${target.name} from ${where}.` }
    },

    async resetProjectChoices(projectPath) {
      const target = deps.resetTarget(projectPath)
      if (!target.ok) return target
      const folder = deps.folder(target.projectPath)
      if (!folder.ok) return folder
      const run = await deps.run(MCP_RESET_ARGS, folder.cwd)
      if (!run.ok) return run
      deps.forgetChecks()
      if (!(await reread('reset'))) return { ok: true, verificationError: UNREREAD_MESSAGE }
      return { ok: true, message: resetMessage(deps.approvals(target.projectPath)) }
    },

    async logout(ref) {
      const target = deps.target(ref, 'logout')
      if (!target.ok) return target
      const folder = deps.folder(target.projectPath)
      if (!folder.ok) return folder
      const run = await deps.run(mcpLogoutArgs(target.name), folder.cwd)
      if (!run.ok) return run
      deps.forgetChecks()
      const check = await deps.serverStatus(target.name, folder.cwd)
      if (!check.ok)
        return {
          ok: true,
          verificationError: `Logout ran, but Megatron couldn't check ${target.name} afterwards: ${check.error}`
        }
      if (check.status === 'needs_auth')
        return {
          ok: true,
          message: `Logged out of ${target.name}. Claude Code will ask you to sign in again.`
        }
      if (check.status === 'connected' || check.status === 'degraded')
        return {
          ok: true,
          verificationError: `Logout ran, but Claude Code still connects to ${target.name}. It may not use sign-in, or it sends a token from its configured headers.`
        }
      return {
        ok: true,
        verificationError: `Logout ran, but Megatron couldn't confirm it: Claude Code couldn't reach ${target.name} to check.`
      }
    },

    async add(input) {
      const refusal =
        mcpAddRefusal(input) ?? deps.addConflict(input.name, input.scope, input.projectPath)
      if (refusal !== null) return { ok: false, error: refusal }
      const folder = deps.folder(input.projectPath)
      if (!folder.ok) return folder
      const run = await deps.run(
        mcpAddArgs(input.name, input.scope),
        folder.cwd,
        JSON.stringify(mcpServerConfig(input))
      )
      if (!run.ok) return run
      deps.forgetChecks()
      const serverId = `configured:${input.name}`
      if (!(await reread('add'))) return { ok: true, serverId, verificationError: UNREREAD_MESSAGE }
      const where = SCOPE_LABELS[input.scope]
      const found = deps.findDeclaration(input.name, input.scope, input.projectPath)
      if (found === null)
        return {
          ok: true,
          serverId,
          verificationError: `Claude Code reported success, but Megatron doesn't find ${input.name} in ${where}. Rescan to check.`
        }
      const approval = found.approval === 'pending' ? PENDING_APPROVAL_NOTE : ''
      return {
        ok: true,
        serverId: found.serverId,
        message: `Added ${input.name} to ${where}.${approval}${commandNote(input, deps.lookupCommand)}`
      }
    }
  }
}
