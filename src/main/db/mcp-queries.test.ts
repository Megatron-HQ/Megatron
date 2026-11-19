import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applySchema } from './schema'
import { getMcpServerDetail, knownMcpPrefixes, listMcpServers } from './mcp-queries'

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  applySchema(db)
  db.prepare(
    `INSERT INTO sessions_meta (session_id, cwd, started_at, message_count, source_mtime_ms)
     VALUES ('s1', '/repo', '2026-11-01T00:00:00.000Z', 1, 0)`
  ).run()
})

afterEach(() => db.close())

interface DeclarationFixture {
  scope: 'local' | 'project' | 'user'
  project?: string
  name: string
  transport?: string | null
  problem?: string | null
  location?: string | null
  credential?: boolean
  approval?: string | null
  env?: { name: string; literal: boolean }[]
}

function declare(fixture: DeclarationFixture): void {
  db.prepare(
    `INSERT INTO mcp_declarations (scope, project_path, name, transport, problem, location,
       env_keys, header_keys, arg_count, has_literal_credential, approval, source_path)
     VALUES (?, ?, ?, ?, ?, ?, ?, '[]', 2, ?, ?, ?)`
  ).run(
    fixture.scope,
    fixture.project ?? '',
    fixture.name,
    fixture.transport === undefined ? 'stdio' : fixture.transport,
    fixture.problem ?? null,
    fixture.location === undefined ? 'npx' : fixture.location,
    JSON.stringify(fixture.env ?? []),
    fixture.credential ? 1 : 0,
    fixture.approval ?? (fixture.scope === 'project' ? 'approved' : null),
    fixture.scope === 'project' ? `${fixture.project}/.mcp.json` : '/home/.claude.json'
  )
}

function installPlugin(
  name: string,
  installPath: string,
  servers: Record<string, string>,
  options: { marketplace?: string; disabled?: boolean; scope?: string; project?: string } = {}
): void {
  db.prepare(
    `INSERT INTO plugin_registry (name, marketplace, installed_version, scope, install_path,
       last_scanned_at, disabled_reason, project_path)
     VALUES (?, ?, '1.0.0', ?, ?, '2026-11-01', ?, ?)`
  ).run(
    name,
    options.marketplace ?? 'market',
    options.scope ?? 'user',
    installPath,
    options.disabled ? 'plugin' : null,
    options.project ?? ''
  )
  for (const [server, detail] of Object.entries(servers))
    db.prepare(
      `INSERT OR IGNORE INTO plugin_components (install_path, kind, name, detail, source_path)
       VALUES (?, 'mcp', ?, ?, ?)`
    ).run(installPath, server, detail, `${installPath}/.mcp.json`)
}

let callNumber = 0
function call(
  qualified: string,
  options: { at?: string; error?: boolean; denied?: boolean; chars?: number; images?: number } = {}
): void {
  callNumber += 1
  db.prepare(
    `INSERT INTO mcp_tool_calls (tool_use_id, session_id, cwd, qualified_name, invoked_at,
       agent_id, is_error, is_denied, result_chars, result_images)
     VALUES (?, 's1', '/repo', ?, ?, NULL, ?, ?, ?, ?)`
  ).run(
    `toolu_${callNumber}`,
    qualified,
    options.at ?? '2026-11-10T00:00:00.000Z',
    options.error || options.denied ? 1 : 0,
    options.denied ? 1 : 0,
    options.chars ?? 0,
    options.images ?? 0
  )
}

function toggle(project: string, server: string, state: 'disabled' | 'enabled' = 'disabled'): void {
  db.prepare(
    'INSERT INTO mcp_server_toggles (project_path, server_name, toggle) VALUES (?, ?, ?)'
  ).run(project, server, state)
}

function projectState(project: string, mcpJson: string | null, connectorsDisabled = false): void {
  db.prepare(
    'INSERT INTO mcp_project_state (project_path, mcp_json, connectors_disabled) VALUES (?, ?, ?)'
  ).run(project, mcpJson, connectorsDisabled ? 1 : 0)
}

function server(id: string): ReturnType<typeof listMcpServers>['servers'][number] {
  const row = listMcpServers(db).servers.find((candidate) => candidate.id === id)
  if (row === undefined) throw new Error(`no server ${id}`)
  return row
}

describe('listMcpServers', () => {
  it('merges one name declared in several scopes into one configured row', () => {
    declare({ scope: 'user', name: 'github', transport: 'http', location: 'api.github.com' })
    declare({ scope: 'local', project: '/a', name: 'github', location: 'gh-mcp' })

    expect(server('configured:github')).toMatchObject({
      name: 'github',
      kind: 'configured',
      prefix: 'github',
      transports: ['http', 'stdio'],
      location: 'gh-mcp',
      scopes: ['local', 'user'],
      projectCount: 1
    })
  })

  it('lists each plugin server once across installs, named as Claude Code registers it', () => {
    installPlugin('playwright', '/cache/a/1.0', { playwright: 'stdio · npx' })
    installPlugin(
      'playwright',
      '/cache/b/1.0',
      { playwright: 'stdio · npx' },
      { marketplace: 'other' }
    )

    const rows = listMcpServers(db).servers.filter((row) => row.kind === 'plugin')
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      id: 'plugin:playwright:playwright',
      name: 'plugin:playwright:playwright',
      prefix: 'plugin_playwright_playwright',
      transports: ['stdio'],
      location: 'npx',
      scopes: ['plugin'],
      pluginDisabled: false
    })
  })

  it('marks a plugin server whose every install is switched off', () => {
    installPlugin('p', '/cache/p', { s: 'http · a.dev' }, { disabled: true })

    expect(server('plugin:p:s').pluginDisabled).toBe(true)
  })

  it('credits calls to the server whose prefix they carry, keeping refusals out of errors', () => {
    declare({ scope: 'user', name: 'github' })
    call('github__list_issues', { at: '2026-11-02T00:00:00.000Z' })
    call('github__create_issue', { error: true, at: '2026-11-05T00:00:00.000Z' })
    call('github__create_issue', { denied: true, at: '2026-11-04T00:00:00.000Z' })

    expect(server('configured:github')).toMatchObject({
      calls: 3,
      errors: 1,
      denied: 1,
      lastUsedAt: '2026-11-05T00:00:00.000Z'
    })
  })

  it('names claude.ai connectors and built-ins seen only in calls', () => {
    call('claude_ai_Google_Drive__search')
    call('claude-in-chrome__navigate')

    expect(server('connector:claude_ai_Google_Drive')).toMatchObject({
      name: 'claude.ai Google Drive',
      kind: 'connector',
      calls: 1
    })
    expect(server('observed:claude-in-chrome')).toMatchObject({
      name: 'claude-in-chrome',
      kind: 'observed',
      calls: 1
    })
  })

  it('knows a connector from the /mcp switch by the exact name Claude Code wrote', () => {
    toggle('/a', 'claude.ai Slack')
    call('claude_ai_Slack__post')

    expect(server('connector:claude_ai_Slack')).toMatchObject({ name: 'claude.ai Slack', calls: 1 })
  })

  it('credits a plugin server through its plugin prefix, not a same-named configured server', () => {
    declare({ scope: 'user', name: 'playwright' })
    installPlugin('playwright', '/cache/a', { playwright: 'stdio · npx' })
    call('plugin_playwright_playwright__browser_click')
    call('playwright__browser_click')

    expect(server('plugin:playwright:playwright').calls).toBe(1)
    expect(server('configured:playwright').calls).toBe(1)
  })

  it('credits calls on a shared prefix to neither server', () => {
    declare({ scope: 'user', name: 'my.server' })
    declare({ scope: 'user', name: 'my_server' })
    call('my_server__run')

    for (const id of ['configured:my.server', 'configured:my_server'])
      expect(server(id)).toMatchObject({ calls: 0, ambiguousCalls: 1, prefixCollision: true })
  })

  it('raises the flags a declaration carries', () => {
    declare({ scope: 'user', name: 'broken', transport: null, problem: 'url_without_type' })
    declare({ scope: 'user', name: 'leaky', credential: true })
    declare({ scope: 'project', project: '/a', name: 'pending', approval: 'pending' })

    expect(server('configured:broken').hasProblem).toBe(true)
    expect(server('configured:leaky').hasLiteralCredential).toBe(true)
    expect(server('configured:pending').hasPendingApproval).toBe(true)
    expect(server('configured:leaky')).toMatchObject({
      hasProblem: false,
      hasPendingApproval: false
    })
  })

  it('reports the call window and how many projects were not readable', () => {
    call('github__a', { at: '2026-11-03T00:00:00.000Z' })
    call('github__b', { at: '2026-11-09T00:00:00.000Z' })
    projectState('', null)
    projectState('/a', 'ungranted')
    projectState('/b', 'ungranted')
    projectState('/c', 'read')

    expect(listMcpServers(db)).toMatchObject({
      firstCallAt: '2026-11-03T00:00:00.000Z',
      lastCallAt: '2026-11-09T00:00:00.000Z',
      ungrantedProjects: 2
    })
  })

  it('sorts servers by name, ignoring case', () => {
    declare({ scope: 'user', name: 'zeta' })
    declare({ scope: 'user', name: 'Alpha' })
    call('claude_ai_Gmail__x')

    expect(listMcpServers(db).servers.map((row) => row.name)).toEqual([
      'Alpha',
      'claude.ai Gmail',
      'zeta'
    ])
  })

  it('lists nothing for an empty index', () => {
    expect(listMcpServers(db)).toEqual({
      servers: [],
      firstCallAt: null,
      lastCallAt: null,
      ungrantedProjects: 0
    })
  })
})

describe('getMcpServerDetail', () => {
  function detail(id: string): NonNullable<ReturnType<typeof getMcpServerDetail>> {
    const result = getMcpServerDetail(db, id, null)
    if (result === null) throw new Error(`no detail for ${id}`)
    return result
  }

  function shadows(id: string): Record<string, unknown[]> {
    return Object.fromEntries(
      detail(id).declarations.map((declaration) => [
        `${declaration.scope}:${declaration.projectPath ?? ''}`,
        declaration.shadowedIn
      ])
    )
  }

  it('returns null for an unknown server', () => {
    expect(getMcpServerDetail(db, 'configured:nope', null)).toBeNull()
  })

  it('marks where each declaration loses by local > approved project > user', () => {
    declare({ scope: 'user', name: 'github' })
    declare({ scope: 'local', project: '/a', name: 'github' })
    declare({ scope: 'project', project: '/b', name: 'github' })
    declare({ scope: 'project', project: '/c', name: 'github', approval: 'pending' })
    declare({ scope: 'project', project: '/a', name: 'github' })

    expect(shadows('configured:github')).toEqual({
      'local:/a': [],
      'project:/a': [{ projectPath: '/a', byScope: 'local', byProjectPath: '/a' }],
      'project:/b': [],
      'project:/c': [],
      'user:': [
        { projectPath: '/a', byScope: 'local', byProjectPath: '/a' },
        { projectPath: '/b', byScope: 'project', byProjectPath: '/b' }
      ]
    })
  })

  it('never lets a declaration Claude Code skips win', () => {
    declare({ scope: 'user', name: 'github' })
    declare({
      scope: 'local',
      project: '/a',
      name: 'github',
      transport: null,
      problem: 'no_endpoint'
    })

    expect(shadows('configured:github')['user:']).toEqual([])
  })

  it('shadows a plugin server whose endpoint a user declaration already serves', () => {
    declare({ scope: 'user', name: 'pw' })
    installPlugin('playwright', '/cache/a', { playwright: 'stdio · npx' })
    db.prepare(
      `INSERT INTO mcp_endpoint_duplicates (install_path, server_name, scope, project_path, name)
       VALUES ('/cache/a', 'playwright', 'user', '', 'pw')`
    ).run()

    expect(detail('plugin:playwright:playwright').declarations).toEqual([
      {
        scope: 'plugin',
        projectPath: null,
        plugin: { name: 'playwright', marketplace: 'market' },
        transport: 'stdio',
        problem: null,
        location: 'npx',
        env: [],
        headers: [],
        argCount: null,
        hasLiteralCredential: false,
        approval: null,
        sourcePath: '/cache/a/.mcp.json',
        shadowedIn: [{ projectPath: null, byScope: 'user', byProjectPath: null }]
      }
    ])
  })

  it('shadows a plugin server only in projects where its duplicate is switched on', () => {
    declare({ scope: 'local', project: '/a', name: 'pw' })
    declare({ scope: 'local', project: '/b', name: 'pw' })
    installPlugin('playwright', '/cache/a', { playwright: 'stdio · npx' })
    for (const project of ['/a', '/b'])
      db.prepare(
        `INSERT INTO mcp_endpoint_duplicates (install_path, server_name, scope, project_path, name)
         VALUES ('/cache/a', 'playwright', 'local', ?, 'pw')`
      ).run(project)
    toggle('/b', 'pw')

    expect(detail('plugin:playwright:playwright').declarations[0].shadowedIn).toEqual([
      { projectPath: '/a', byScope: 'local', byProjectPath: '/a' }
    ])
  })

  it('reads plugin transport labels, including the ones Claude Code skips', () => {
    installPlugin('p', '/cache/p', { a: 'missing type · a.dev', b: 'bundle', c: 'sse' })

    expect(detail('plugin:p:a').declarations[0]).toMatchObject({
      transport: null,
      problem: 'url_without_type',
      location: 'a.dev'
    })
    expect(detail('plugin:p:b').declarations[0]).toMatchObject({ transport: null, location: null })
    expect(detail('plugin:p:c').declarations[0]).toMatchObject({ transport: 'sse', location: null })
  })

  it('lists the projects whose /mcp switch turned a server off, by its Claude Code name', () => {
    declare({ scope: 'user', name: 'github' })
    installPlugin('p', '/cache/p', { s: 'stdio · x' })
    toggle('/b', 'github')
    toggle('/a', 'github')
    toggle('/a', 'plugin:p:s')
    toggle('/c', 'claude.ai Gmail')
    toggle('/d', 'github', 'enabled')

    expect(detail('configured:github').disabledIn).toEqual(['/a', '/b'])
    expect(detail('plugin:p:s').disabledIn).toEqual(['/a'])
    expect(detail('connector:claude_ai_Gmail').disabledIn).toEqual(['/c'])
  })

  it('lists where claude.ai connectors are switched off as a group', () => {
    call('claude_ai_Gmail__search')
    projectState('', null, false)
    projectState('/a', 'read', true)

    expect(detail('connector:claude_ai_Gmail').connectorsDisabledIn).toEqual(['/a'])
    projectState('/b', 'read', false)
    db.prepare("UPDATE mcp_project_state SET connectors_disabled = 1 WHERE project_path = ''").run()
    expect(detail('connector:claude_ai_Gmail').connectorsDisabledIn).toEqual(['', '/a'])
  })

  it('summarizes usage per tool, busiest first', () => {
    declare({ scope: 'user', name: 'github' })
    call('github__get', { chars: 300, at: '2026-11-02T00:00:00.000Z' })
    call('github__list', { chars: 30, images: 1, at: '2026-11-03T00:00:00.000Z' })
    call('github__list', { error: true, chars: 3, at: '2026-11-04T00:00:00.000Z' })
    call('github__list', { denied: true, at: '2026-11-01T00:00:00.000Z' })

    expect(detail('configured:github').tools).toEqual([
      {
        tool: 'list',
        calls: 3,
        errors: 1,
        denied: 1,
        resultTokens: 11,
        resultImages: 1,
        lastUsedAt: '2026-11-04T00:00:00.000Z'
      },
      {
        tool: 'get',
        calls: 1,
        errors: 0,
        denied: 0,
        resultTokens: 100,
        resultImages: 0,
        lastUsedAt: '2026-11-02T00:00:00.000Z'
      }
    ])
  })

  it('reads definition tokens for its prefix from the last /context run', () => {
    call('claude_ai_Gmail__search')
    const baseline = {
      byPrefix: new Map([['claude_ai_Gmail', 1_359]]),
      measuredAt: '2026-11-18T00:00:00.000Z'
    }

    expect(getMcpServerDetail(db, 'connector:claude_ai_Gmail', baseline)?.definitionTokens).toEqual(
      { tokens: 1_359, measuredAt: '2026-11-18T00:00:00.000Z' }
    )
    declare({ scope: 'user', name: 'github' })
    expect(getMcpServerDetail(db, 'configured:github', baseline)?.definitionTokens).toBeNull()
  })
})

describe('MCP lint through the queries', () => {
  it('counts warnings and notices on each row', () => {
    declare({ scope: 'user', name: 'github', credential: true })
    declare({ scope: 'local', project: '/a', name: 'github' })
    declare({ scope: 'project', project: '/b', name: 'github', approval: 'pending' })

    expect(server('configured:github')).toMatchObject({ warnings: 1, notices: 2 })
  })

  it('lists the findings on the detail', () => {
    declare({ scope: 'user', name: 'broken', transport: null, problem: 'url_without_type' })

    expect(getMcpServerDetail(db, 'configured:broken', null)?.findings).toEqual([
      expect.objectContaining({ ruleId: 'mcp-server-skipped', scope: 'user', projectPath: null })
    ])
  })

  it('names the other servers sharing a prefix', () => {
    declare({ scope: 'user', name: 'my.server' })
    declare({ scope: 'user', name: 'my_server' })

    const [finding] = getMcpServerDetail(db, 'configured:my.server', null)!.findings
    expect(finding.ruleId).toBe('mcp-prefix-collision')
    expect(finding.message).toContain('my_server')
    expect(finding.message).not.toContain('my.server,')
  })
})

describe('knownMcpPrefixes', () => {
  it('knows user, plugin, connector, and seen servers everywhere, and the rest per project', () => {
    declare({ scope: 'user', name: 'github' })
    declare({ scope: 'local', project: 'C:/Work/App', name: 'db.local' })
    declare({ scope: 'project', project: '/repo', name: 'api', approval: 'pending' })
    installPlugin('playwright', '/cache/a', { playwright: 'stdio · npx' })
    toggle('/x', 'claude.ai Slack')
    call('claude-in-chrome__navigate')

    const known = knownMcpPrefixes(db)

    expect([...known.everywhere].sort()).toEqual([
      'claude-in-chrome',
      'claude_ai_Slack',
      'github',
      'plugin_playwright_playwright'
    ])
    expect(Object.fromEntries([...known.byProject].map(([key, set]) => [key, [...set]]))).toEqual({
      'c:/work/app': ['db_local'],
      '/repo': ['api']
    })
  })
})
