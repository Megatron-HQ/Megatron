import { describe, expect, it } from 'vitest'
import {
  emptyMcpAddDraft,
  hasLiteralValues,
  mcpAddDraftErrors,
  mcpAddInput,
  mcpToolPrefix,
  parsePastedMcpJson,
  type McpAddDraft
} from './mcp-add-form'

const STDIO: McpAddDraft = {
  ...emptyMcpAddDraft(null),
  name: 'github',
  command: 'npx',
  argsText: '-y\n@modelcontextprotocol/server-github\n',
  env: [{ name: 'GITHUB_TOKEN', value: '${GITHUB_TOKEN}', literal: false }]
}

describe('emptyMcpAddDraft', () => {
  it('starts in user scope, or local scope for the project it was opened from', () => {
    expect(emptyMcpAddDraft(null)).toMatchObject({
      scope: 'user',
      projectPath: null,
      transport: 'stdio'
    })
    expect(emptyMcpAddDraft('/repo')).toMatchObject({ scope: 'local', projectPath: '/repo' })
  })
})

describe('parsePastedMcpJson', () => {
  it('reads a bare server object, marking values without a ${VAR} as literal', () => {
    const result = parsePastedMcpJson(
      '{"command":"npx","args":["-y","pkg"],"env":{"TOKEN":"${TOKEN}","LEVEL":"debug"}}'
    )
    expect(result).toEqual({
      ok: true,
      name: null,
      fields: {
        transport: 'stdio',
        command: 'npx',
        argsText: '-y\npkg',
        url: '',
        env: [
          { name: 'TOKEN', value: '${TOKEN}', literal: false },
          { name: 'LEVEL', value: 'debug', literal: true }
        ],
        headers: []
      }
    })
  })

  it('takes the name from an mcpServers wrapper, as READMEs print it', () => {
    const result = parsePastedMcpJson(
      '{"mcpServers":{"sentry":{"type":"http","url":"https://mcp.sentry.dev/mcp","headers":{"Authorization":"Bearer ${SENTRY_TOKEN}"}}}}'
    )
    expect(result).toMatchObject({
      ok: true,
      name: 'sentry',
      fields: {
        transport: 'http',
        url: 'https://mcp.sentry.dev/mcp',
        headers: [{ name: 'Authorization', value: 'Bearer ${SENTRY_TOKEN}', literal: false }]
      }
    })
  })

  it('reads a {"name": {...}} snippet and a streamable-http type', () => {
    expect(
      parsePastedMcpJson('{"linear":{"type":"streamable-http","url":"https://mcp.linear.app/mcp"}}')
    ).toMatchObject({ ok: true, name: 'linear', fields: { transport: 'http' } })
  })

  it('reads a named snippet whose name is also a server field', () => {
    const result = parsePastedMcpJson('{"command":{"type":"stdio","command":"node"}}')
    expect(result).toMatchObject({ ok: true, name: 'command', fields: { command: 'node' } })
  })

  it('preserves empty, quoted and multiline arguments from a snippet', () => {
    const args = ['', '"quoted"', 'one\ntwo', 'with spaces']
    const pasted = parsePastedMcpJson(JSON.stringify({ command: 'node', args }))
    expect(pasted).toMatchObject({ ok: true })
    if (pasted.ok) expect(mcpAddInput({ ...STDIO, ...pasted.fields }).args).toEqual(args)
  })

  it.each([
    ['text that is not JSON', 'npx -y pkg', /JSON/],
    [
      'several servers at once',
      '{"mcpServers":{"a":{"command":"x"},"b":{"command":"y"}}}',
      /one server/
    ],
    ['a server with neither command nor url', '{"foo":1}', /command or a url/],
    ['an unknown type', '{"type":"grpc","url":"https://a.dev"}', /type/]
  ])('refuses %s', (_label, text, message) => {
    const result = parsePastedMcpJson(text)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(message)
  })
})

describe('mcpAddInput', () => {
  it('turns the draft into the request main checks again', () => {
    expect(mcpAddInput(STDIO)).toEqual({
      name: 'github',
      scope: 'user',
      projectPath: null,
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      url: '',
      env: [{ name: 'GITHUB_TOKEN', value: '${GITHUB_TOKEN}' }],
      headers: []
    })
  })

  it('sends a remote server its URL and headers only, and user scope no project', () => {
    const input = mcpAddInput({
      ...STDIO,
      transport: 'sse',
      url: ' https://a.dev/sse ',
      headers: [{ name: 'X-Key', value: '${KEY}', literal: false }],
      projectPath: '/stale'
    })
    expect(input).toMatchObject({
      command: '',
      args: [],
      env: [],
      url: 'https://a.dev/sse',
      projectPath: null
    })
    expect(input.headers).toEqual([{ name: 'X-Key', value: '${KEY}' }])
  })
})

describe('mcpAddDraftErrors', () => {
  it('finds nothing wrong in a complete draft', () => {
    expect(mcpAddDraftErrors(STDIO)).toEqual({})
  })

  it('names each field the user still has to fix', () => {
    expect(
      mcpAddDraftErrors({
        ...STDIO,
        name: 'my server',
        scope: 'project',
        projectPath: null,
        command: '',
        env: [{ name: 'TOKEN', value: 'abc', literal: false }]
      })
    ).toEqual({
      name: expect.stringMatching(/letters, numbers/),
      project: expect.any(String),
      command: expect.any(String),
      'env.0': expect.stringMatching(/\$\{/)
    })
  })

  it('accepts a literal only once it is switched to one', () => {
    expect(
      mcpAddDraftErrors({ ...STDIO, env: [{ name: 'TOKEN', value: 'abc', literal: true }] })
    ).toEqual({})
  })

  it("checks a remote server's URL and its header names", () => {
    expect(
      mcpAddDraftErrors({
        ...STDIO,
        transport: 'http',
        url: 'ftp://x',
        headers: [{ name: 'Bad Name', value: '${V}', literal: false }]
      })
    ).toEqual({ url: expect.any(String), 'headers.0': expect.any(String) })
  })
})

describe('mcpToolPrefix', () => {
  it("shows the tool names Claude Code will give the server's tools", () => {
    expect(mcpToolPrefix('my-server_2')).toBe('mcp__my-server_2__')
  })
})

describe('hasLiteralValues', () => {
  it('is true only for a literal the transport actually sends', () => {
    expect(hasLiteralValues(STDIO)).toBe(false)
    expect(hasLiteralValues({ ...STDIO, env: [{ name: 'T', value: 'abc', literal: true }] })).toBe(
      true
    )
    expect(
      hasLiteralValues({
        ...STDIO,
        transport: 'http',
        env: [{ name: 'T', value: 'abc', literal: true }]
      })
    ).toBe(false)
  })
})
