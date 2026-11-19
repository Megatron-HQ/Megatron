// How Claude Code names an MCP server's tools, and how a stored call finds its server
// (docs/mcp-servers.md, Tool names and Tool-call attribution).

const NAME_SEPARATOR = '__'
const CONNECTOR_PREFIX = 'claude_ai_'
const CONNECTOR_NAME_PREFIX = 'claude.ai '

export function sanitizeMcpServerName(name: string): string {
  return name.replace(/[^A-Za-z0-9_-]/g, '_')
}

export function pluginServerPrefix(plugin: string, server: string): string {
  return sanitizeMcpServerName(`plugin_${plugin}_${server}`)
}

export interface QualifiedName {
  prefix: string
  tool: string
}

// The longest known prefix wins, since a sanitized prefix can itself hold `__`; a name no known
// server explains splits at its first separator and becomes an Observed server.
export function resolveQualifiedName(
  qualified: string,
  knownPrefixes: ReadonlySet<string>
): QualifiedName | null {
  let best: string | null = null
  for (const prefix of knownPrefixes)
    if (
      qualified.length > prefix.length + NAME_SEPARATOR.length &&
      qualified.startsWith(prefix + NAME_SEPARATOR) &&
      (best === null || prefix.length > best.length)
    )
      best = prefix
  if (best !== null)
    return { prefix: best, tool: qualified.slice(best.length + NAME_SEPARATOR.length) }

  const separator = qualified.indexOf(NAME_SEPARATOR)
  if (separator <= 0 || qualified.length <= separator + NAME_SEPARATOR.length) return null
  return {
    prefix: qualified.slice(0, separator),
    tool: qualified.slice(separator + NAME_SEPARATOR.length)
  }
}

// Best effort: sanitizing already turned the connector's spaces and punctuation into `_`.
export function connectorDisplayName(prefix: string): string | null {
  if (!prefix.startsWith(CONNECTOR_PREFIX) || prefix.length === CONNECTOR_PREFIX.length) return null
  return CONNECTOR_NAME_PREFIX + prefix.slice(CONNECTOR_PREFIX.length).replace(/_/g, ' ')
}
