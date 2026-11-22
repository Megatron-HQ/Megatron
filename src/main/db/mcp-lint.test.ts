import { describe, expect, it } from 'vitest'
import type { McpDeclarationDetail, McpLintFinding } from '../../shared/ipc'
import { lintMcpServer } from './mcp-lint'
import type { CommandLookup } from '../command-lookup'

function declaration(overrides: Partial<McpDeclarationDetail> = {}): McpDeclarationDetail {
  return {
    scope: 'user',
    projectPath: null,
    plugin: null,
    transport: 'stdio',
    problem: null,
    location: 'npx',
    env: [],
    headers: [],
    argCount: 0,
    hasLiteralCredential: false,
    approval: null,
    sourcePath: '/home/.claude.json',
    shadowedIn: [],
    commandIsBare: false,
    ...overrides
  }
}

function lint(declarations: McpDeclarationDetail[], sharedWith: string[] = []): McpLintFinding[] {
  return lintMcpServer({ name: 'github', prefix: 'github', declarations, sharedWith })
}

describe('lintMcpServer', () => {
  it('finds nothing in a clean server', () => {
    expect(lint([declaration()])).toEqual([])
  })

  it('names the literal keys of a config holding a credential, never their values', () => {
    const [finding] = lint([
      declaration({
        scope: 'local',
        projectPath: '/a',
        hasLiteralCredential: true,
        env: [
          { name: 'GITHUB_TOKEN', literal: true },
          { name: 'HOME', literal: false }
        ],
        headers: [{ name: 'Authorization', literal: true }]
      })
    ])

    expect(finding).toMatchObject({
      ruleId: 'mcp-inlined-credential',
      severity: 'warning',
      scope: 'local',
      projectPath: '/a'
    })
    expect(finding.message).toContain('GITHUB_TOKEN')
    expect(finding.message).toContain('Authorization')
    expect(finding.message).not.toContain('HOME')
    expect(finding.message).toContain('${VAR}')
  })

  it('points at args or the URL when no env or header value is literal', () => {
    const [finding] = lint([declaration({ hasLiteralCredential: true })])

    expect(finding.message).toMatch(/args or URL/)
  })

  it('notes a project server still waiting for approval', () => {
    expect(
      lint([declaration({ scope: 'project', projectPath: '/repo', approval: 'pending' })])
    ).toEqual([
      expect.objectContaining({
        ruleId: 'mcp-pending-approval',
        severity: 'info',
        scope: 'project',
        projectPath: '/repo'
      })
    ])
  })

  it('notes each project where a declaration loses, and to what', () => {
    const [finding] = lint([
      declaration({
        shadowedIn: [
          { projectPath: '/a', byScope: 'local', byProjectPath: '/a' },
          { projectPath: '/b', byScope: 'project', byProjectPath: '/b' }
        ]
      })
    ])

    expect(finding).toMatchObject({ ruleId: 'mcp-shadowed', severity: 'info', scope: 'user' })
    expect(finding.message).toContain('/a (local)')
    expect(finding.message).toContain('/b (project)')
  })

  it('says a plugin server shadowed by a user declaration loses everywhere', () => {
    const [finding] = lint([
      declaration({
        scope: 'plugin',
        plugin: { name: 'playwright', marketplace: 'market' },
        shadowedIn: [{ projectPath: null, byScope: 'user', byProjectPath: null }]
      })
    ])

    expect(finding.message).toContain('every project (user)')
    expect(finding.message).toContain('playwright')
  })

  it('warns once, about the whole server, when another server shares its prefix', () => {
    const findings = lint(
      [declaration(), declaration({ scope: 'local', projectPath: '/a' })],
      ['my.github', 'my_github']
    )

    expect(findings).toEqual([
      expect.objectContaining({
        ruleId: 'mcp-prefix-collision',
        severity: 'warning',
        scope: null,
        projectPath: null
      })
    ])
    expect(findings[0].message).toContain('mcp__github__')
    expect(findings[0].message).toContain('my.github, my_github')
  })

  it.each([
    ['url_without_type', /"type": "http"/],
    ['unknown_type', /type/],
    ['no_endpoint', /command or url/]
  ] as const)('warns that Claude Code skips a server with %s', (problem, wording) => {
    const [finding] = lint([declaration({ transport: null, problem })])

    expect(finding).toMatchObject({ ruleId: 'mcp-server-skipped', severity: 'warning' })
    expect(finding.message).toMatch(/skips/)
    expect(finding.message).toMatch(wording)
  })

  it('never calls a skipped server shadowed or pending', () => {
    expect(
      lint([
        declaration({
          scope: 'project',
          projectPath: '/repo',
          approval: 'pending',
          transport: null,
          problem: 'url_without_type'
        })
      ]).map((finding) => finding.ruleId)
    ).toEqual(['mcp-server-skipped'])
  })
})

describe('mcp-command-not-found', () => {
  const uvx = (overrides: Partial<McpDeclarationDetail> = {}): McpDeclarationDetail =>
    declaration({ location: 'uvx', commandIsBare: true, ...overrides })

  function lintCommand(
    declarations: McpDeclarationDetail[],
    answer: CommandLookup,
    calledRecently = false
  ): McpLintFinding[] {
    return lintMcpServer({
      name: 'github',
      prefix: 'github',
      declarations,
      sharedWith: [],
      lookupCommand: () => answer,
      calledRecently
    })
  }

  it('tells the user when a bare command is on no PATH folder Megatron can see', () => {
    expect(lintCommand([uvx({ scope: 'local', projectPath: '/a' })], 'missing')).toEqual([
      {
        ruleId: 'mcp-command-not-found',
        severity: 'info',
        message:
          "The local config for /a runs uvx, which Megatron can't find on PATH. If Claude Code can't either, the server won't start: install uvx, or give the command's full path.",
        scope: 'local',
        projectPath: '/a'
      }
    ])
  })

  it.each<CommandLookup>(['found', 'unknown'])(
    'says nothing when the lookup answers %s',
    (answer) => {
      expect(lintCommand([uvx()], answer)).toEqual([])
    }
  )

  it('says nothing for a server called in the last 30 days, which evidently starts', () => {
    expect(lintCommand([uvx()], 'missing', true)).toEqual([])
  })

  it('says nothing when the declaration sets its own PATH', () => {
    expect(lintCommand([uvx({ env: [{ name: 'Path', literal: true }] })], 'missing')).toEqual([])
  })

  it('says nothing for a command given with a folder, a remote server, or a skipped one', () => {
    expect(
      lintCommand(
        [
          uvx({ commandIsBare: false }),
          uvx({ transport: 'http', location: 'a.dev', commandIsBare: false }),
          uvx({ problem: 'no_endpoint' })
        ],
        'missing'
      ).map((finding) => finding.ruleId)
    ).toEqual(['mcp-server-skipped'])
  })

  it('says nothing without a lookup, as in the scan worker and older callers', () => {
    expect(lint([uvx()])).toEqual([])
  })
})
