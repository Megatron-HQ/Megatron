import Database from 'better-sqlite3'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { dirname, join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applySchema } from '../db/schema'
import { defaultConfigRoot, grantPath, resetGrantedPaths, setClaudeConfig } from '../permissions'
import { scanMcpDeclarations } from './mcp-declarations'
import { mcpEndpointKey } from './mcp-server-config'

let db: Database.Database
let tmpDir: string
let claudeJson: string
let settingsPath: string
let granted: string
let ungranted: string

interface DeclarationRow {
  scope: string
  project_path: string
  name: string
  transport: string | null
  problem: string | null
  location: string | null
  env_keys: string
  header_keys: string
  arg_count: number
  has_literal_credential: number
  approval: string | null
  source_path: string
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'megatron-mcp-'))
  const configDir = join(tmpDir, '.claude')
  mkdirSync(configDir)
  claudeJson = join(tmpDir, '.claude.json')
  settingsPath = join(configDir, 'settings.json')
  setClaudeConfig({ directory: configDir, claudeJson, source: 'default' })
  granted = join(tmpDir, 'granted')
  ungranted = join(tmpDir, 'ungranted')
  mkdirSync(granted)
  mkdirSync(ungranted)
  grantPath(granted)
  db = new Database(':memory:')
  applySchema(db)
})

afterEach(() => {
  db.close()
  resetGrantedPaths()
  setClaudeConfig(defaultConfigRoot(homedir()))
  rmSync(tmpDir, { recursive: true, force: true })
})

function write(path: string, content: unknown): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, typeof content === 'string' ? content : JSON.stringify(content))
}

function declarations(): DeclarationRow[] {
  return db
    .prepare('SELECT * FROM mcp_declarations ORDER BY scope, project_path, name')
    .all() as DeclarationRow[]
}

function brief(): [string, string, string, string | null][] {
  return declarations().map((row) => [row.scope, row.project_path, row.name, row.approval])
}

function projectState(): {
  project_path: string
  mcp_json: string | null
  connectors_disabled: number
}[] {
  return db.prepare('SELECT * FROM mcp_project_state ORDER BY project_path').all() as {
    project_path: string
    mcp_json: string | null
    connectors_disabled: number
  }[]
}

describe('user and local scope', () => {
  it('reads user servers from top-level mcpServers', () => {
    write(claudeJson, {
      mcpServers: { github: { type: 'http', url: 'https://api.githubcopilot.com/mcp/' } }
    })

    expect(scanMcpDeclarations(db)).toEqual({ status: 'complete' })
    expect(declarations()).toEqual([
      {
        scope: 'user',
        project_path: '',
        name: 'github',
        transport: 'http',
        problem: null,
        location: 'api.githubcopilot.com',
        env_keys: '[]',
        header_keys: '[]',
        arg_count: 0,
        has_literal_credential: 0,
        approval: null,
        source_path: claudeJson
      }
    ])
  })

  it('reads local servers from each project entry, for granted and ungranted projects alike', () => {
    write(claudeJson, {
      projects: {
        [granted]: { mcpServers: { db: { command: 'npx', env: { DB_PASSWORD: 'hunter2' } } } },
        [ungranted]: { mcpServers: { notes: { command: 'notes-mcp' } } }
      }
    })

    scanMcpDeclarations(db)

    expect(brief()).toEqual([
      ['local', granted, 'db', null],
      ['local', ungranted, 'notes', null]
    ])
    const row = declarations()[0]
    expect(row.env_keys).toBe('[{"name":"DB_PASSWORD","literal":true}]')
    expect(row.has_literal_credential).toBe(1)
  })

  it('records config problems that make Claude Code skip a server', () => {
    write(claudeJson, { mcpServers: { linear: { url: 'https://mcp.linear.app/mcp' } } })

    scanMcpDeclarations(db)

    expect(declarations()[0]).toMatchObject({
      transport: null,
      problem: 'url_without_type',
      location: 'mcp.linear.app'
    })
  })

  it('skips a server entry that is not an object', () => {
    write(claudeJson, { mcpServers: { broken: 'npx thing', ok: { command: 'ok' } } })

    scanMcpDeclarations(db)

    expect(brief()).toEqual([['user', '', 'ok', null]])
  })

  // Claude Code has written one folder under several spellings ('C:/x', 'c:/x', 'C:\x').
  it('folds Windows spellings of one project into the first key seen', () => {
    write(claudeJson, {
      projects: {
        'C:/Work/App': { mcpServers: { a: { command: 'a' } } },
        'c:\\Work\\App': { mcpServers: { a: { command: 'other' }, b: { command: 'b' } } }
      }
    })

    scanMcpDeclarations(db)

    expect(brief()).toEqual([
      ['local', 'C:/Work/App', 'a', null],
      ['local', 'C:/Work/App', 'b', null]
    ])
    expect(declarations()[0].location).toBe('a')
  })
})

describe('project scope', () => {
  it('reads .mcp.json from a granted project as pending until approved', () => {
    write(claudeJson, { projects: { [granted]: {} } })
    write(join(granted, '.mcp.json'), {
      mcpServers: { api: { type: 'sse', url: 'https://a.dev' } }
    })

    scanMcpDeclarations(db)

    expect(brief()).toEqual([['project', granted, 'api', 'pending']])
    expect(declarations()[0].source_path).toBe(join(granted, '.mcp.json'))
  })

  it('never reads .mcp.json from an ungranted project, recording that it could not', () => {
    write(claudeJson, { projects: { [ungranted]: {} } })
    write(join(ungranted, '.mcp.json'), { mcpServers: { api: { command: 'x' } } })

    scanMcpDeclarations(db)

    expect(brief()).toEqual([])
    expect(projectState()).toEqual([
      { project_path: '', mcp_json: null, connectors_disabled: 0 },
      { project_path: ungranted, mcp_json: 'ungranted', connectors_disabled: 0 }
    ])
  })

  it('reads .mcp.json from projects found by discovery but never opened in Claude Code', () => {
    write(join(granted, '.mcp.json'), { mcpServers: { api: { command: 'x' } } })

    scanMcpDeclarations(db, { candidateProjects: [granted] })

    expect(brief()).toEqual([['project', granted, 'api', 'pending']])
  })

  it('records a missing .mcp.json without a declaration', () => {
    write(claudeJson, { projects: { [granted]: {} } })

    expect(scanMcpDeclarations(db)).toEqual({ status: 'complete' })
    expect(projectState()).toContainEqual({
      project_path: granted,
      mcp_json: 'missing',
      connectors_disabled: 0
    })
  })

  it('reports an invalid .mcp.json and drops its servers', () => {
    write(claudeJson, { projects: { [granted]: {} } })
    write(join(granted, '.mcp.json'), { mcpServers: { api: { command: 'x' } } })
    scanMcpDeclarations(db)
    write(join(granted, '.mcp.json'), '{not json')

    expect(scanMcpDeclarations(db)).toEqual({
      status: 'partial',
      issues: [{ code: 'settings_invalid', path: join(granted, '.mcp.json') }]
    })
    expect(brief()).toEqual([])
    expect(projectState()).toContainEqual({
      project_path: granted,
      mcp_json: 'invalid',
      connectors_disabled: 0
    })
  })

  it('keeps the last known servers when .mcp.json exists but cannot be read', () => {
    write(claudeJson, { projects: { [granted]: {} } })
    write(join(granted, '.mcp.json'), { mcpServers: { api: { command: 'x' } } })
    scanMcpDeclarations(db)
    rmSync(join(granted, '.mcp.json'))
    mkdirSync(join(granted, '.mcp.json'))

    expect(scanMcpDeclarations(db)).toEqual({
      status: 'partial',
      issues: [{ code: 'source_unavailable', path: join(granted, '.mcp.json') }]
    })
    expect(brief()).toEqual([['project', granted, 'api', 'pending']])
  })
})

describe('project approval', () => {
  function approvalWith(
    projectEntry: Record<string, unknown>,
    files: Record<string, unknown> = {}
  ): string | null {
    write(claudeJson, { projects: { [granted]: projectEntry } })
    write(join(granted, '.mcp.json'), { mcpServers: { api: { command: 'x' } } })
    for (const [path, content] of Object.entries(files)) write(path, content)
    scanMcpDeclarations(db)
    return declarations()[0].approval
  }

  it('approves a server listed in the project entry', () => {
    expect(approvalWith({ enabledMcpjsonServers: ['api'] })).toBe('approved')
  })

  it('rejects a server listed as disabled, even when also enabled', () => {
    expect(approvalWith({ enabledMcpjsonServers: ['api'], disabledMcpjsonServers: ['api'] })).toBe(
      'rejected'
    )
  })

  it('rejects from user settings', () => {
    expect(
      approvalWith(
        { enabledMcpjsonServers: ['api'] },
        { [settingsPath]: { disabledMcpjsonServers: ['api'] } }
      )
    ).toBe('rejected')
  })

  it('approves every server when user settings enable all project servers', () => {
    expect(approvalWith({}, { [settingsPath]: { enableAllProjectMcpServers: true } })).toBe(
      'approved'
    )
  })

  it("ignores an untrusted repo's own committed approval", () => {
    expect(
      approvalWith(
        {},
        { [join(granted, '.claude', 'settings.json')]: { enabledMcpjsonServers: ['api'] } }
      )
    ).toBe('pending')
  })

  it("honors a trusted repo's own committed approval", () => {
    expect(
      approvalWith(
        { hasTrustDialogAccepted: true },
        { [join(granted, '.claude', 'settings.json')]: { enableAllProjectMcpServers: true } }
      )
    ).toBe('approved')
  })

  it('treats a project inside a trusted folder as trusted', () => {
    write(claudeJson, {
      projects: { [tmpDir]: { hasTrustDialogAccepted: true }, [granted]: {} }
    })
    write(join(granted, '.mcp.json'), { mcpServers: { api: { command: 'x' } } })
    write(join(granted, '.claude', 'settings.json'), { enabledMcpjsonServers: ['api'] })

    scanMcpDeclarations(db)

    expect(declarations()[0].approval).toBe('approved')
  })

  it("rejects from a repo's own disabled list even when untrusted", () => {
    expect(
      approvalWith(
        { enabledMcpjsonServers: ['api'] },
        { [join(granted, '.claude', 'settings.json')]: { disabledMcpjsonServers: ['api'] } }
      )
    ).toBe('rejected')
  })

  it('approves from settings.local.json', () => {
    expect(
      approvalWith(
        {},
        { [join(granted, '.claude', 'settings.local.json')]: { enabledMcpjsonServers: ['api'] } }
      )
    ).toBe('approved')
  })
})

describe('per-project toggles', () => {
  it('stores the /mcp on and off lists as Claude Code wrote them', () => {
    write(claudeJson, {
      projects: {
        [granted]: {
          disabledMcpServers: ['github', 'claude.ai Slack', 'plugin:p:s', 7],
          enabledMcpServers: ['computer-use']
        }
      }
    })

    scanMcpDeclarations(db)

    expect(
      db.prepare('SELECT * FROM mcp_server_toggles ORDER BY toggle, server_name').all()
    ).toEqual([
      { project_path: granted, server_name: 'claude.ai Slack', toggle: 'disabled' },
      { project_path: granted, server_name: 'github', toggle: 'disabled' },
      { project_path: granted, server_name: 'plugin:p:s', toggle: 'disabled' },
      { project_path: granted, server_name: 'computer-use', toggle: 'enabled' }
    ])
  })

  it('records claude.ai connectors switched off in user or project settings', () => {
    write(claudeJson, { projects: { [granted]: {}, [ungranted]: {} } })
    write(join(granted, '.claude', 'settings.json'), { disableClaudeAiConnectors: true })

    scanMcpDeclarations(db)
    expect(projectState().map((row) => [row.project_path, row.connectors_disabled])).toEqual([
      ['', 0],
      [granted, 1],
      [ungranted, 0]
    ])

    write(settingsPath, { disableClaudeAiConnectors: true })
    scanMcpDeclarations(db)
    expect(projectState().every((row) => row.connectors_disabled === 1)).toBe(true)
  })
})

describe('.claude.json itself', () => {
  it('clears earlier servers once the file is gone', () => {
    write(claudeJson, { mcpServers: { a: { command: 'a' } } })
    scanMcpDeclarations(db)
    rmSync(claudeJson)

    expect(scanMcpDeclarations(db)).toEqual({ status: 'complete' })
    expect(brief()).toEqual([])
  })

  it('keeps the last known servers when the file is malformed', () => {
    write(claudeJson, { mcpServers: { a: { command: 'a' } } })
    scanMcpDeclarations(db)
    write(claudeJson, '{"mcpServers":')

    expect(scanMcpDeclarations(db)).toEqual({
      status: 'partial',
      issues: [{ code: 'settings_invalid', path: claudeJson }]
    })
    expect(brief()).toEqual([['user', '', 'a', null]])
  })

  it('reports an mcpServers value that is not an object', () => {
    write(claudeJson, { mcpServers: ['a'] })

    expect(scanMcpDeclarations(db)).toEqual({
      status: 'partial',
      issues: [{ code: 'settings_invalid', path: claudeJson }]
    })
    expect(brief()).toEqual([])
  })

  it('replaces servers removed since the last scan', () => {
    write(claudeJson, { mcpServers: { a: { command: 'a' }, b: { command: 'b' } } })
    scanMcpDeclarations(db)
    write(claudeJson, { mcpServers: { b: { command: 'b' } } })

    scanMcpDeclarations(db)

    expect(brief()).toEqual([['user', '', 'b', null]])
  })
})

describe('plugin endpoint duplicates', () => {
  function duplicates(): unknown[] {
    return db.prepare('SELECT * FROM mcp_endpoint_duplicates ORDER BY server_name').all()
  }

  it('records a plugin server that points at the same endpoint as a declaration', () => {
    write(claudeJson, {
      mcpServers: { gh: { type: 'http', url: 'https://api.github.com/mcp/' } },
      projects: { [granted]: { mcpServers: { pw: { command: 'npx', args: ['playwright'] } } } }
    })
    const pluginEndpoints = new Map([
      ['/plugins/a\0github', mcpEndpointKey({ type: 'http', url: 'https://API.github.com/mcp' })!],
      ['/plugins/b\0playwright', mcpEndpointKey({ command: 'npx', args: ['playwright'] })!],
      ['/plugins/c\0lonely', mcpEndpointKey({ command: 'lonely' })!]
    ])

    scanMcpDeclarations(db, { pluginEndpoints })

    expect(duplicates()).toEqual([
      {
        install_path: '/plugins/a',
        server_name: 'github',
        scope: 'user',
        project_path: '',
        name: 'gh'
      },
      {
        install_path: '/plugins/b',
        server_name: 'playwright',
        scope: 'local',
        project_path: granted,
        name: 'pw'
      }
    ])
  })

  it('never matches a declaration Claude Code skips', () => {
    write(claudeJson, { mcpServers: { gh: { url: 'https://api.github.com/mcp' } } })
    const pluginEndpoints = new Map([
      ['/plugins/a\0github', mcpEndpointKey({ type: 'http', url: 'https://api.github.com/mcp' })!]
    ])

    scanMcpDeclarations(db, { pluginEndpoints })

    expect(duplicates()).toEqual([])
  })

  it('replaces earlier duplicates on each scan', () => {
    write(claudeJson, { mcpServers: { gh: { command: 'gh-mcp' } } })
    const pluginEndpoints = new Map([
      ['/plugins/a\0github', mcpEndpointKey({ command: 'gh-mcp' })!]
    ])
    scanMcpDeclarations(db, { pluginEndpoints })
    write(claudeJson, { mcpServers: {} })

    scanMcpDeclarations(db, { pluginEndpoints })

    expect(duplicates()).toEqual([])
  })
})
