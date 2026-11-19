import { describe, expect, it } from 'vitest'
import { mcpEndpointKey, summarizeMcpServer } from './mcp-server-config'

describe('summarizeMcpServer transport', () => {
  it.each([
    [{ command: 'npx' }, 'stdio', null],
    [{ type: 'stdio', command: 'npx' }, 'stdio', null],
    [{ type: 'http', url: 'https://a.dev/mcp' }, 'http', null],
    [{ type: 'streamable-http', url: 'https://a.dev/mcp' }, 'http', null],
    [{ type: 'sse', url: 'https://a.dev/sse' }, 'sse', null],
    [{ type: 'ws', url: 'wss://a.dev/socket' }, 'ws', null],
    // Claude Code reads a missing type as stdio and skips an entry that has a url instead.
    [{ url: 'https://a.dev/mcp' }, null, 'url_without_type'],
    [{ type: 'carrier-pigeon', url: 'https://a.dev' }, null, 'unknown_type'],
    [{ type: 'http' }, 'http', 'no_endpoint'],
    [{}, 'stdio', 'no_endpoint'],
    [{ command: '   ' }, 'stdio', 'no_endpoint']
  ])('reads %j as %s with problem %s', (config, transport, problem) => {
    const summary = summarizeMcpServer(config)
    expect(summary.transport).toBe(transport)
    expect(summary.problem).toBe(problem)
  })
})

describe('summarizeMcpServer location', () => {
  it('keeps only the URL host and port', () => {
    const summary = summarizeMcpServer({
      type: 'http',
      url: 'https://user:secret@mcp.vercel.com:8443/path?token=abc'
    })
    expect(summary.location).toBe('mcp.vercel.com:8443')
  })

  it('keeps the host of a url-without-type entry so the user can find it', () => {
    expect(summarizeMcpServer({ url: 'https://mcp.linear.app/mcp' }).location).toBe(
      'mcp.linear.app'
    )
  })

  it('shows no host for an unexpanded variable', () => {
    expect(summarizeMcpServer({ type: 'sse', url: '${API_URL}/mcp' }).location).toBeNull()
  })

  it.each([
    ['npx', 'npx'],
    ['/usr/local/bin/uvx', 'uvx'],
    ['C:\\Program Files\\nodejs\\node.exe', 'Program'],
    ['node --api-key=secret server.js', 'node']
  ])('keeps only the first word of command %s, without its folder', (command, location) => {
    expect(summarizeMcpServer({ command }).location).toBe(location)
  })
})

describe('summarizeMcpServer env, headers and args', () => {
  it('keeps env and header key names, marking which values are literal', () => {
    const summary = summarizeMcpServer({
      type: 'http',
      url: 'https://a.dev',
      env: { GITHUB_TOKEN: '${GITHUB_TOKEN}', LOG_LEVEL: 'debug', RETRIES: 3 },
      headers: { Authorization: 'Bearer ${API_KEY}', 'X-Team': 'core' }
    })
    expect(summary.env).toEqual([
      { name: 'GITHUB_TOKEN', literal: false },
      { name: 'LOG_LEVEL', literal: true },
      { name: 'RETRIES', literal: true }
    ])
    expect(summary.headers).toEqual([
      { name: 'Authorization', literal: false },
      { name: 'X-Team', literal: true }
    ])
  })

  it('counts args without keeping any', () => {
    const summary = summarizeMcpServer({ command: 'npx', args: ['-y', 'pkg', '--flag'] })
    expect(summary.argCount).toBe(3)
  })

  it('treats a non-array args, env, or headers as absent', () => {
    const summary = summarizeMcpServer({ command: 'npx', args: 'oops', env: ['A'], headers: 7 })
    expect(summary.argCount).toBe(0)
    expect(summary.env).toEqual([])
    expect(summary.headers).toEqual([])
  })
})

describe('summarizeMcpServer inlined credentials', () => {
  it.each([
    ['a token-named env literal', { command: 'x', env: { GITHUB_TOKEN: 'abc123' } }],
    ['an api-key env literal', { command: 'x', env: { OPENAI_API_KEY: 'abc' } }],
    ['a password env literal', { command: 'x', env: { DB_PASSWORD: 'hunter2' } }],
    [
      'a literal Authorization header',
      { type: 'http', url: 'https://a.dev', headers: { Authorization: 'Bearer abc123' } }
    ],
    [
      'a literal x-api-key header',
      { type: 'http', url: 'https://a.dev', headers: { 'x-api-key': 'k' } }
    ],
    ['a value after --api-key', { command: 'x', args: ['--api-key', 'abc123'] }],
    ['a value after --token', { command: 'x', args: ['--token', 'abc123'] }],
    ['an --api-key= arg', { command: 'x', args: ['--api-key=abc123'] }],
    ['a known token prefix', { command: 'x', args: ['ghp_aBcDeFgHiJkLmNoPqRsT1234567890'] }],
    ['an Anthropic key', { command: 'x', args: ['sk-ant-api03-abc'] }],
    ['a Slack token', { command: 'x', env: { SLACK: 'xoxb-123-456' } }],
    ['a long mixed-case random arg', { command: 'x', args: ['aZ3kP9qL2mN8vB4xC7tR1yW6uE5oI0sD'] }],
    ['URL userinfo', { type: 'http', url: 'https://user:pass@a.dev/mcp' }],
    ['a credential query parameter', { type: 'http', url: 'https://a.dev/mcp?api_key=abc' }],
    ['a token query parameter', { type: 'sse', url: 'https://a.dev/sse?token=abc' }]
  ])('flags %s', (_label, config) => {
    expect(summarizeMcpServer(config).hasLiteralCredential).toBe(true)
  })

  it.each([
    ['a referenced token', { command: 'x', env: { GITHUB_TOKEN: '${GITHUB_TOKEN}' } }],
    ['a referenced token with a default', { command: 'x', env: { TOKEN: '${TOKEN:-}' } }],
    [
      'a header mixing a literal scheme and a reference',
      { type: 'http', url: 'https://a.dev', headers: { Authorization: 'Bearer ${API_KEY}' } }
    ],
    ['an empty token', { command: 'x', env: { GITHUB_TOKEN: '' } }],
    ['a non-secret env literal', { command: 'x', env: { LOG_LEVEL: 'debug' } }],
    ['a package name', { command: 'npx', args: ['-y', '@modelcontextprotocol/server-github'] }],
    ['a Windows path', { command: 'node', args: ['C:\\Users\\me\\mcp\\ServerMain.js'] }],
    ['a POSIX path', { command: 'node', args: ['/Users/me/Projects/mcpServerWithLongName/index'] }],
    ['a lowercase UUID', { command: 'x', args: ['123e4567-e89b-12d3-a456-426614174000'] }],
    ['a referenced flag value', { command: 'x', args: ['--api-key', '${API_KEY}'] }],
    ['a harmless query', { type: 'http', url: 'https://a.dev/mcp?page=2' }],
    ['referenced userinfo', { type: 'http', url: 'https://${MCP_USER}:${MCP_PASS}@a.dev/mcp' }],
    ['a referenced query value', { type: 'http', url: 'https://a.dev/mcp?api_key=${KEY}' }]
  ])('does not flag %s', (_label, config) => {
    expect(summarizeMcpServer(config).hasLiteralCredential).toBe(false)
  })

  it('flags malformed escapes in URL userinfo instead of throwing', () => {
    expect(
      summarizeMcpServer({ type: 'http', url: 'https://to%ZZken@a.dev/mcp' }).hasLiteralCredential
    ).toBe(true)
  })

  it('never carries a config value in the summary', () => {
    const secrets = ['ghp_SECRETvalue123', 'hunter2', 'pass', 'qtok', 'argsecret', 'pathsecret']
    const summary = summarizeMcpServer({
      type: 'http',
      url: 'https://user:pass@a.dev/pathsecret?token=qtok',
      env: { GITHUB_TOKEN: 'ghp_SECRETvalue123' },
      headers: { Authorization: 'hunter2' },
      args: ['--token', 'argsecret']
    })
    const serialized = JSON.stringify(summary)
    for (const secret of secrets) expect(serialized).not.toContain(secret)
  })
})

describe('mcpEndpointKey', () => {
  it.each([
    ['https://Mcp.Example.com:443/mcp/', 'https://mcp.example.com/mcp'],
    ['HTTPS://mcp.example.com/mcp', 'https://mcp.example.com/mcp'],
    ['http://mcp.example.com:80/mcp', 'http://mcp.example.com/mcp'],
    ['https://mcp.example.com', 'https://mcp.example.com/']
  ])('treats %s and %s as one endpoint', (first, second) => {
    const a = mcpEndpointKey({ type: 'http', url: first })
    expect(a).not.toBeNull()
    expect(a).toBe(mcpEndpointKey({ type: 'http', url: second }))
  })

  it.each([
    ['https://mcp.example.com/mcp', 'https://mcp.example.com/other'],
    ['https://mcp.example.com/mcp', 'https://mcp.example.com/mcp?team=a'],
    ['https://mcp.example.com/mcp', 'https://mcp.example.com:8443/mcp'],
    ['https://mcp.example.com/mcp', 'https://u@mcp.example.com/mcp'],
    ['https://mcp.example.com/MCP', 'https://mcp.example.com/mcp']
  ])('keeps %s and %s apart', (first, second) => {
    expect(mcpEndpointKey({ type: 'http', url: first })).not.toBe(
      mcpEndpointKey({ type: 'http', url: second })
    )
  })

  it('matches stdio servers by command and args', () => {
    const key = mcpEndpointKey({ command: 'npx', args: ['-y', 'pkg'] })
    expect(key).toBe(mcpEndpointKey({ type: 'stdio', command: 'npx', args: ['-y', 'pkg'] }))
    expect(key).not.toBe(mcpEndpointKey({ command: 'npx', args: ['-y', 'other'] }))
    expect(key).not.toBe(mcpEndpointKey({ type: 'http', url: 'npx' }))
  })

  it.each([
    ['a url without a type', { url: 'https://a.dev/mcp' }],
    ['an unknown type', { type: 'pigeon', url: 'https://a.dev' }],
    ['no endpoint', { type: 'http' }],
    ['an unparseable url', { type: 'http', url: 'not a url' }]
  ])('has no endpoint for %s, which Claude Code never connects', (_label, config) => {
    expect(mcpEndpointKey(config)).toBeNull()
  })
})
