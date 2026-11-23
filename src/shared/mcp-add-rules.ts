import type { McpAddTransport } from './ipc'

// Field rules for adding an MCP server (#50), shared so the form and main's parse
// (parseMcpAddInput) can never disagree. Main still checks every request again.

export const MAX_MCP_SERVER_NAME_LENGTH = 100
// Claude Code's own rule for a server name (verified 2026-11-22, 2.1.330: add-json refuses any
// other character).
export const MCP_SERVER_NAME = /^[A-Za-z0-9_-]+$/
// What a shell or Claude Code expands as ${NAME}, and an HTTP header's token characters.
export const MCP_ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
export const MCP_HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/
// A `${VAR}` or `${VAR:-default}` reference, as Claude Code expands it in a server's config.
export const MCP_VARIABLE_REFERENCE = /\$\{[A-Za-z_][A-Za-z0-9_]*(?::-[^}]*)?\}/

const URL_PROTOCOLS: Record<Exclude<McpAddTransport, 'stdio'>, string[]> = {
  http: ['https:', 'http:'],
  sse: ['https:', 'http:'],
  ws: ['wss:', 'ws:']
}

export function mcpServerNameError(name: string): string | null {
  const trimmed = name.trim()
  if (trimmed === '') return 'Give the server a name.'
  if (trimmed.length > MAX_MCP_SERVER_NAME_LENGTH)
    return `Keep the name to ${MAX_MCP_SERVER_NAME_LENGTH} characters.`
  return MCP_SERVER_NAME.test(trimmed)
    ? null
    : 'Use only letters, numbers, hyphens and underscores in the name.'
}

export function mcpUrlError(
  transport: Exclude<McpAddTransport, 'stdio'>,
  url: string
): string | null {
  if (url.trim() === '') return 'Give the server its URL.'
  const protocols = URL_PROTOCOLS[transport]
  try {
    return protocols.includes(new URL(url.trim()).protocol)
      ? null
      : `A ${transport === 'ws' ? 'WebSocket' : 'web'} server's URL starts with ${protocols.map((protocol) => `${protocol}//`).join(' or ')}.`
  } catch {
    return "That URL can't be read."
  }
}
