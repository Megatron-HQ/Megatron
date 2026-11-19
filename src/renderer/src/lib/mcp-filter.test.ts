import { describe, expect, it } from 'vitest'
import type { McpServerRow } from '../../../shared/ipc'
import {
  isMcpFilterEqual,
  matchesMcpFilter,
  mcpFilterCounts,
  mcpFilterTitle,
  mcpSourceLabel,
  type McpFilter
} from './mcp-filter'

function row(overrides: Partial<McpServerRow>): McpServerRow {
  return {
    id: 'configured:x',
    name: 'x',
    kind: 'configured',
    prefix: 'x',
    transports: [],
    location: null,
    scopes: [],
    projectCount: 0,
    projectPaths: [],
    calls: 0,
    errors: 0,
    denied: 0,
    ambiguousCalls: 0,
    lastUsedAt: null,
    hasProblem: false,
    hasLiteralCredential: false,
    hasPendingApproval: false,
    prefixCollision: false,
    pluginDisabled: false,
    warnings: 0,
    notices: 0,
    liveStatus: null,
    ...overrides
  }
}

const userServer = row({
  id: 'configured:github',
  // Rows list scopes in precedence order.
  scopes: ['local', 'user'],
  projectPaths: ['C:/Work/App']
})
const projectServer = row({
  id: 'configured:api',
  scopes: ['project'],
  projectPaths: ['/repo/pkg']
})
const plugin = row({ id: 'plugin:p:s', kind: 'plugin', scopes: ['plugin'] })
const connector = row({ id: 'connector:claude_ai_Gmail', kind: 'connector' })
const observed = row({ id: 'observed:claude-in-chrome', kind: 'observed' })
const all = [userServer, projectServer, plugin, connector, observed]

function ids(filter: McpFilter): string[] {
  return all.filter((server) => matchesMcpFilter(server, filter)).map((server) => server.id)
}

describe('matchesMcpFilter', () => {
  it.each([
    [
      { kind: 'all' },
      [
        'configured:github',
        'configured:api',
        'plugin:p:s',
        'connector:claude_ai_Gmail',
        'observed:claude-in-chrome'
      ]
    ],
    [{ kind: 'user' }, ['configured:github']],
    [{ kind: 'projects' }, ['configured:github', 'configured:api']],
    [{ kind: 'plugins' }, ['plugin:p:s']],
    [{ kind: 'connectors' }, ['connector:claude_ai_Gmail']],
    [{ kind: 'observed' }, ['observed:claude-in-chrome']]
  ] as [McpFilter, string[]][])('keeps %j', (filter, expected) => {
    expect(ids(filter)).toEqual(expected)
  })

  it('matches a selected folder and everything under it', () => {
    expect(ids({ kind: 'projects', projectPath: '/repo' })).toEqual(['configured:api'])
    expect(ids({ kind: 'projects', projectPath: '/repo', exact: true })).toEqual([])
    expect(ids({ kind: 'projects', projectPath: '/repo/pkg', exact: true })).toEqual([
      'configured:api'
    ])
  })

  it('compares Windows spellings of one folder as one', () => {
    expect(ids({ kind: 'projects', projectPath: 'c:\\work\\app', exact: true })).toEqual([
      'configured:github'
    ])
  })
})

describe('mcpFilterCounts', () => {
  it('counts each sidebar group', () => {
    expect(mcpFilterCounts(all)).toEqual({
      all: 5,
      user: 1,
      projects: 2,
      plugins: 1,
      connectors: 1,
      observed: 1
    })
  })
})

describe('isMcpFilterEqual', () => {
  it('compares kind, folder, and exactness', () => {
    expect(isMcpFilterEqual({ kind: 'plugins' }, { kind: 'plugins' })).toBe(true)
    expect(isMcpFilterEqual({ kind: 'plugins' }, { kind: 'observed' })).toBe(false)
    expect(
      isMcpFilterEqual(
        { kind: 'projects', projectPath: '/a' },
        { kind: 'projects', projectPath: '/a', exact: true }
      )
    ).toBe(false)
  })
})

describe('labels', () => {
  it.each([
    [{ kind: 'all' }, 'All MCP servers'],
    [{ kind: 'user' }, 'User servers'],
    [{ kind: 'projects' }, 'Project servers'],
    [{ kind: 'plugins' }, 'Plugin servers'],
    [{ kind: 'connectors' }, 'claude.ai connectors'],
    [{ kind: 'observed' }, 'Observed servers']
  ] as [McpFilter, string][])('titles %j as %s', (filter, title) => {
    expect(mcpFilterTitle(filter)).toBe(title)
  })

  it.each([
    [userServer, 'Local · User'],
    [projectServer, 'Project'],
    [plugin, 'Plugin'],
    [connector, 'claude.ai'],
    [observed, 'Observed']
  ])('labels the source of %#', (server, label) => {
    expect(mcpSourceLabel(server)).toBe(label)
  })
})
