import type {
  McpConfigProblem,
  McpDeclarationDetail,
  McpLintFinding,
  McpShadow
} from '../../shared/ipc'

// MCP lint rules (docs/mcp-servers.md, Lint). Pure: every input is already in the index, so
// findings are derived each time a server is read rather than stored.

export interface McpLintInput {
  name: string
  prefix: string
  declarations: McpDeclarationDetail[]
  // The other servers whose tool names carry the same prefix.
  sharedWith: string[]
}

const SKIPPED_REASON: Record<McpConfigProblem, string> = {
  url_without_type:
    'has a url but no type, so Claude Code skips it. Add "type": "http" (or "sse" / "ws").',
  unknown_type: "has a type Claude Code doesn't recognize, so Claude Code skips it.",
  no_endpoint: 'has no command or url, so Claude Code skips it.'
}

function declarationLabel(declaration: McpDeclarationDetail): string {
  switch (declaration.scope) {
    case 'user':
      return 'The user config'
    case 'local':
      return `The local config for ${declaration.projectPath}`
    case 'project':
      return `${declaration.projectPath}/.mcp.json`
    case 'plugin':
      return `Plugin ${declaration.plugin?.name ?? 'server'}`
  }
}

function shadowPlace(shadow: McpShadow): string {
  return `${shadow.projectPath ?? 'every project'} (${shadow.byScope})`
}

function literalKeys(declaration: McpDeclarationDetail): string[] {
  return [...declaration.env, ...declaration.headers]
    .filter((key) => key.literal)
    .map((key) => key.name)
}

function declarationFindings(declaration: McpDeclarationDetail): McpLintFinding[] {
  const label = declarationLabel(declaration)
  const at = { scope: declaration.scope, projectPath: declaration.projectPath }
  // A server Claude Code skips never loads, so whether it would win or wait for approval is moot.
  if (declaration.problem !== null)
    return [
      {
        ruleId: 'mcp-server-skipped',
        severity: 'warning',
        message: `${label} ${SKIPPED_REASON[declaration.problem]}`,
        ...at
      }
    ]

  const findings: McpLintFinding[] = []
  if (declaration.hasLiteralCredential) {
    const keys = literalKeys(declaration)
    const where = keys.length > 0 ? `literal values in ${keys.join(', ')}` : 'its args or URL'
    findings.push({
      ruleId: 'mcp-inlined-credential',
      severity: 'warning',
      message: `${label} writes what looks like a credential into the file (${where}). Reference an environment variable with \${VAR} instead.`,
      ...at
    })
  }
  if (declaration.approval === 'pending')
    findings.push({
      ruleId: 'mcp-pending-approval',
      severity: 'info',
      message: `${label} is waiting for approval: Claude Code asks before using a server from a project's .mcp.json.`,
      ...at
    })
  if (declaration.shadowedIn.length > 0)
    findings.push({
      ruleId: 'mcp-shadowed',
      severity: 'info',
      message: `${label} loses to a higher-priority declaration in ${declaration.shadowedIn.map(shadowPlace).join(', ')}.`,
      ...at
    })
  return findings
}

export function lintMcpServer(input: McpLintInput): McpLintFinding[] {
  const findings = input.declarations.flatMap(declarationFindings)
  if (input.sharedWith.length > 0)
    findings.push({
      ruleId: 'mcp-prefix-collision',
      severity: 'warning',
      message: `Shares the tool prefix mcp__${input.prefix}__ with ${input.sharedWith.join(', ')}, so its calls can't be told apart and count for neither.`,
      scope: null,
      projectPath: null
    })
  return findings
}
