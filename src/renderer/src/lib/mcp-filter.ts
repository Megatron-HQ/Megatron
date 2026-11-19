import type { McpDeclarationScope, McpServerRow } from '../../../shared/ipc'
import { isWithinProjectPath, normalizeProjectPath } from '../../../shared/project-path'

// The MCP section's sidebar groups (docs/mcp-servers.md, Sources). Scope names follow Claude Code's
// own vocabulary, like the Plugins section's.
export type McpFilter =
  | { kind: 'all' }
  | { kind: 'user' }
  | { kind: 'projects'; projectPath?: string; exact?: boolean }
  | { kind: 'plugins' }
  | { kind: 'connectors' }
  | { kind: 'observed' }

export type McpFilterKind = McpFilter['kind']

function inProject(server: McpServerRow, projectPath: string, exact: boolean): boolean {
  return server.projectPaths.some((path) =>
    exact
      ? normalizeProjectPath(path) === normalizeProjectPath(projectPath)
      : isWithinProjectPath(path, projectPath)
  )
}

export function matchesMcpFilter(server: McpServerRow, filter: McpFilter): boolean {
  switch (filter.kind) {
    case 'all':
      return true
    case 'user':
      return server.scopes.includes('user')
    case 'projects':
      return (
        server.kind !== 'plugin' &&
        server.projectPaths.length > 0 &&
        (!filter.projectPath || inProject(server, filter.projectPath, !!filter.exact))
      )
    case 'plugins':
      return server.kind === 'plugin'
    case 'connectors':
      return server.kind === 'connector'
    case 'observed':
      return server.kind === 'observed'
  }
}

export function mcpFilterCounts(servers: McpServerRow[]): Record<McpFilterKind, number> {
  const count = (filter: McpFilter): number =>
    servers.filter((server) => matchesMcpFilter(server, filter)).length
  return {
    all: servers.length,
    user: count({ kind: 'user' }),
    projects: count({ kind: 'projects' }),
    plugins: count({ kind: 'plugins' }),
    connectors: count({ kind: 'connectors' }),
    observed: count({ kind: 'observed' })
  }
}

export function isMcpFilterEqual(a: McpFilter, b: McpFilter): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'projects' && b.kind === 'projects')
    return a.projectPath === b.projectPath && !!a.exact === !!b.exact
  return true
}

const FILTER_TITLE: Record<McpFilterKind, string> = {
  all: 'All MCP servers',
  user: 'User servers',
  projects: 'Project servers',
  plugins: 'Plugin servers',
  connectors: 'claude.ai connectors',
  observed: 'Observed servers'
}

export function mcpFilterTitle(filter: McpFilter): string {
  return FILTER_TITLE[filter.kind]
}

const SCOPE_LABEL: Record<McpDeclarationScope, string> = {
  local: 'Local',
  project: 'Project',
  user: 'User',
  plugin: 'Plugin'
}

// Where a server comes from, in precedence order for a configured one ('Local · User').
export function mcpSourceLabel(server: McpServerRow): string {
  switch (server.kind) {
    case 'configured':
      return server.scopes.map((scope) => SCOPE_LABEL[scope]).join(' · ')
    case 'plugin':
      return 'Plugin'
    case 'connector':
      return 'claude.ai'
    case 'observed':
      return 'Observed'
  }
}
