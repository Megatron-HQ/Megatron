import type {
  McpActionResult,
  McpDeclarationDetail,
  McpDeclarationRef,
  McpTransport
} from '../../../shared/ipc'

// Which MCP actions a Declaration offers in the detail view (docs/mcp-servers.md, Writes). Main
// checks every request again against the index; this only decides what to show.

export interface McpDeclarationActions {
  remove: boolean
  logout: boolean
  reset: boolean
}

const REMOTE_TRANSPORTS = new Set<McpTransport>(['http', 'sse', 'ws'])
const NO_ACTIONS: McpDeclarationActions = { remove: false, logout: false, reset: false }

export function mcpDeclarationActions(declaration: McpDeclarationDetail): McpDeclarationActions {
  if (declaration.scope === 'plugin') return NO_ACTIONS
  return {
    remove: true,
    logout: declaration.transport !== null && REMOTE_TRANSPORTS.has(declaration.transport),
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
