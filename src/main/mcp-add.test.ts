import { describe, expect, it } from 'vitest'
import type { McpAddInput } from '../shared/ipc'
import { mcpAddArgs, mcpAddRefusal, mcpServerConfig, parseMcpAddInput } from './mcp-add'

const STDIO: McpAddInput = {
  name: 'github',
  scope: 'user',
  projectPath: null,
  transport: 'stdio',
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-github'],
  url: '',
  env: [{ name: 'GITHUB_TOKEN', value: '${GITHUB_TOKEN}' }],
  headers: []
}
const HTTP: McpAddInput = {
  ...STDIO,
  name: 'sentry',
  transport: 'http',
  command: '',
  args: [],
  url: 'https://mcp.sentry.dev/mcp',
  env: [],
  headers: [{ name: 'Authorization', value: 'Bearer ${SENTRY_TOKEN}' }]
}

function refused(input: unknown): string {
  const result = parseMcpAddInput(input)
  if (result.ok) throw new Error('expected a refusal')
  return result.error
}

describe('parseMcpAddInput', () => {
  it('accepts a stdio and a remote server, trimming the name', () => {
    expect(parseMcpAddInput({ ...STDIO, name: '  github ' })).toEqual({
      ok: true,
      value: { ...STDIO, name: 'github' }
    })
    expect(parseMcpAddInput(HTTP)).toEqual({ ok: true, value: HTTP })
  })

  it.each([
    ['a non-object', null],
    ['an empty name', { ...STDIO, name: '  ' }],
    ['a name over 100 characters', { ...STDIO, name: 'x'.repeat(101) }],
    ['a name with a line break', { ...STDIO, name: 'a\nb' }],
    ['a name with a character Claude Code refuses', { ...STDIO, name: 'my.server' }],
    ['a name with a space', { ...STDIO, name: 'my server' }],
    ['an unknown scope', { ...STDIO, scope: 'managed' }],
    ['a user server with a project', { ...STDIO, projectPath: '/repo' }],
    [
      'a local server without an absolute project',
      { ...STDIO, scope: 'local', projectPath: 'repo' }
    ],
    ['an unknown transport', { ...STDIO, transport: 'grpc' }],
    ['a stdio server without a command', { ...STDIO, command: ' ' }],
    ['a NUL anywhere', { ...STDIO, args: ['ok', 'b\0ad'] }],
    ['too many args', { ...STDIO, args: Array.from({ length: 101 }, () => 'a') }],
    [
      'an env name that is not a variable name',
      { ...STDIO, env: [{ name: 'MY-KEY', value: 'x' }] }
    ],
    [
      'the same env name twice',
      {
        ...STDIO,
        env: [
          { name: 'A', value: '1' },
          { name: 'A', value: '2' }
        ]
      }
    ],
    ['a remote server without a URL', { ...HTTP, url: '' }],
    ['an HTTP server with a non-web URL', { ...HTTP, url: 'file:///etc/passwd' }],
    ['a WebSocket server with an http URL', { ...HTTP, transport: 'ws', url: 'https://a.dev' }],
    ['a header name with a space', { ...HTTP, headers: [{ name: 'X Key', value: 'v' }] }]
  ])('refuses %s', (_label, input) => {
    expect(refused(input)).toEqual(expect.any(String))
  })
})

describe('parseMcpAddInput messages', () => {
  it('names both URL schemes a web server can use', () => {
    expect(refused({ ...HTTP, url: 'ftp://x' })).toBe(
      "A web server's URL starts with https:// or http://."
    )
    expect(refused({ ...HTTP, transport: 'ws', url: 'https://x' })).toBe(
      "A WebSocket server's URL starts with wss:// or ws://."
    )
  })

  it('says which characters a name may use, as Claude Code does', () => {
    expect(refused({ ...STDIO, name: 'my.server' })).toBe(
      'Use only letters, numbers, hyphens and underscores in the name.'
    )
  })
})

describe('mcpServerConfig', () => {
  it('builds the stdio JSON Claude Code stores, env included', () => {
    expect(mcpServerConfig(STDIO)).toEqual({
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: { GITHUB_TOKEN: '${GITHUB_TOKEN}' }
    })
  })

  it('builds the remote JSON with its headers and no stdio fields', () => {
    expect(mcpServerConfig(HTTP)).toEqual({
      type: 'http',
      url: 'https://mcp.sentry.dev/mcp',
      headers: { Authorization: 'Bearer ${SENTRY_TOKEN}' }
    })
  })

  it('leaves out empty env, args and headers', () => {
    expect(mcpServerConfig({ ...STDIO, args: [], env: [] })).toEqual({
      type: 'stdio',
      command: 'npx'
    })
  })
})

describe('mcpAddRefusal', () => {
  const leaky = {
    ...STDIO,
    env: [{ name: 'GITHUB_TOKEN', value: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789' }]
  }

  it("refuses a credential literal in a project's shared .mcp.json, naming the key", () => {
    expect(mcpAddRefusal({ ...leaky, scope: 'project', projectPath: '/repo' })).toMatch(
      /GITHUB_TOKEN.*\$\{GITHUB_TOKEN\}/
    )
  })

  it('lets local and user scope keep a literal, which only this machine reads', () => {
    expect(mcpAddRefusal(leaky)).toBeNull()
    expect(mcpAddRefusal({ ...leaky, scope: 'local', projectPath: '/repo' })).toBeNull()
  })

  it('accepts a project server whose secrets are references', () => {
    expect(mcpAddRefusal({ ...STDIO, scope: 'project', projectPath: '/repo' })).toBeNull()
  })

  it('refuses a credential in a project server URL', () => {
    expect(
      mcpAddRefusal({
        ...HTTP,
        scope: 'project',
        projectPath: '/repo',
        headers: [],
        url: 'https://mcp.example.com/mcp?api_key=sk_live_abcdefghijklmnop1234'
      })
    ).toEqual(expect.any(String))
  })
})

describe('mcpAddArgs', () => {
  it('reads the JSON from stdin, never the command line, and ends the options before the name', () => {
    expect(mcpAddArgs('-dash', 'user')).toEqual([
      'mcp',
      'add-json',
      '--scope',
      'user',
      '--',
      '-dash',
      '-'
    ])
  })
})
