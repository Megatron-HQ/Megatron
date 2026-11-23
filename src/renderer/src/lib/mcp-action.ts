import type {
  McpActionResult,
  McpDeclarationDetail,
  McpDeclarationRef,
  McpLiveStatus,
  McpLoginRef,
  McpTransport
} from '../../../shared/ipc'

// Which MCP actions a Declaration offers in the detail view (docs/mcp-servers.md, Writes). Main
// checks every request again against the index; this only decides what to show.

export interface McpDeclarationActions {
  remove: boolean
  logout: boolean
  // Signing in runs Claude Code's own login in a terminal window (#50); remote servers only.
  login: boolean
  reset: boolean
}

const REMOTE_TRANSPORTS = new Set<McpTransport>(['http', 'sse', 'ws'])
const NO_ACTIONS: McpDeclarationActions = {
  remove: false,
  logout: false,
  login: false,
  reset: false
}

export function mcpDeclarationActions(declaration: McpDeclarationDetail): McpDeclarationActions {
  if (declaration.scope === 'plugin') return NO_ACTIONS
  const remote = declaration.transport !== null && REMOTE_TRANSPORTS.has(declaration.transport)
  return {
    remove: true,
    logout: remote,
    login: remote,
    reset: declaration.scope === 'project' && declaration.projectPath !== null
  }
}

export function mcpDeclarationRef(
  serverId: string,
  declaration: McpDeclarationDetail
): McpDeclarationRef | null {
  if (declaration.scope === 'plugin') return null
  return { serverId, scope: declaration.scope, projectPath: declaration.projectPath }
}

// A connector (declaration null) signs in account-wide, so its ref names no scope or project.
export function mcpLoginRef(
  serverId: string,
  declaration: McpDeclarationDetail | null
): McpLoginRef | null {
  if (declaration === null) return { serverId, scope: null, projectPath: null }
  if (declaration.scope === 'plugin') return null
  return { serverId, scope: declaration.scope, projectPath: declaration.projectPath }
}

// Without a check Megatron can't know whether a connector is signed in, so only a connection the
// last check confirmed hides the offer.
export function connectorOffersLogin(
  live: { status: McpLiveStatus; checkedAt: string } | null
): boolean {
  return live?.status !== 'connected' && live?.status !== 'degraded'
}
// unconfirmed: the command ran, but its effect couldn't be confirmed, so it reads as a warning
// rather than a failure.
export class McpActionError extends Error {
  constructor(
    message: string,
    readonly unconfirmed: boolean
  ) {
    super(message)
    this.name = 'McpActionError'
  }
}

export function mcpActionMessage(result: McpActionResult): string {
  if (!result.ok) throw new McpActionError(result.error, false)
  if ('verificationError' in result) throw new McpActionError(result.verificationError, true)
  return result.message
}
