import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runClaude } from './claude-process'
import { grantPath, resetGrantedPaths } from './permissions'
import {
  checkMcpConnections,
  checkMcpServer,
  forgetMcpChecks,
  latestMcpChecks,
  mcpCheckFolder,
  parseMcpGetStatus,
  parseMcpList,
  resetMcpChecks
} from './mcp-status'

vi.mock('./claude-process', () => ({ runClaude: vi.fn() }))
const mockedRunClaude = vi.mocked(runClaude)

// Shaped like real `claude mcp list` output (Claude Code 2.1.327, 2026-11-18): the middle of each
// line is the server's URL or command line, credentials included.
const LIST_OUTPUT = [
  'Checking MCP server health…',
  '',
  'claude.ai Claude Docs: https://api.anthropic.com/mcp?token=SECRET1 - ✔ Connected',
  'claude.ai Linear: https://mcp.linear.app/mcp - ! Needs authentication',
  'github: npx -y @mcp/github --token ghp_SECRET2 - ✗ Failed to connect',
  '    connect ECONNREFUSED 127.0.0.1:3000 - token=SECRET3 - ✔ Connected',
  'plugin:playwright:playwright: npx @playwright/mcp@latest - ✔ Connected',
  'dashes: node run - fast - now - ! Connected · tools fetch failed',
  'api: https://a.dev/mcp - ⏸ Pending approval (run `claude` to approve)',
  'old: https://b.dev - ✗ Rejected (see disabledMcpjsonServers in settings)',
  'off: off-mcp - ⊘ Disabled for this project (re-enable via /mcp)',
  'flaky: flaky-mcp - ✗ Connection error',
  'gone: gone-mcp - - Not configured',
  'future: future-mcp - ? Something Megatron has never seen',
  'no separator line at all'
].join('\n')

describe('parseMcpList', () => {
  it('keeps each server name and its status, mapped from the CLI wording', () => {
    expect(parseMcpList(LIST_OUTPUT)).toEqual([
      { name: 'claude.ai Claude Docs', status: 'connected' },
      { name: 'claude.ai Linear', status: 'needs_auth' },
      { name: 'github', status: 'failed' },
      { name: 'plugin:playwright:playwright', status: 'connected' },
      { name: 'dashes', status: 'degraded' },
      { name: 'api', status: 'pending_approval' },
      { name: 'old', status: 'rejected' },
      { name: 'off', status: 'disabled' },
      { name: 'flaky', status: 'failed' },
      { name: 'gone', status: 'not_configured' }
    ])
  })

  it('never carries a URL, command, argument, or issue line', () => {
    expect(JSON.stringify(parseMcpList(LIST_OUTPUT))).not.toMatch(/SECRET|https|npx|127\.0\.0\.1/)
  })

  it('handles Windows line endings', () => {
    expect(parseMcpList('a: x - ✔ Connected\r\nb: y - ! Needs authentication\r\n')).toEqual([
      { name: 'a', status: 'connected' },
      { name: 'b', status: 'needs_auth' }
    ])
  })

  it('keeps the first report of a name printed twice', () => {
    expect(parseMcpList('a: x - ✔ Connected\na: y - ✗ Failed to connect')).toEqual([
      { name: 'a', status: 'connected' }
    ])
  })
})

describe('mcpCheckFolder', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'megatron-mcp-check-'))
  })

  afterEach(() => {
    resetGrantedPaths()
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('creates an empty app-private folder for the general check', () => {
    const result = mcpCheckFolder(null, tmpDir)

    expect(result).toEqual({ ok: true, cwd: join(tmpDir, 'mcp-check') })
    expect(statSync(join(tmpDir, 'mcp-check')).isDirectory()).toBe(true)
  })

  it('runs a project check from a granted project folder', () => {
    const project = join(tmpDir, 'repo')
    mkdirSync(project)
    grantPath(project)

    expect(mcpCheckFolder(project, tmpDir)).toEqual({ ok: true, cwd: project })
  })

  it('refuses a project Megatron may not read', () => {
    const project = join(tmpDir, 'repo')
    mkdirSync(project)

    expect(mcpCheckFolder(project, tmpDir)).toMatchObject({ ok: false })
  })

  it('refuses a granted path that is not a folder', () => {
    const file = join(tmpDir, 'file.txt')
    writeFileSync(file, 'x')
    grantPath(tmpDir)

    expect(mcpCheckFolder(file, tmpDir)).toMatchObject({ ok: false })
  })

  it('names the change, not a check, when refusing a folder for an action', () => {
    const project = join(tmpDir, 'repo')
    mkdirSync(project)

    const refused = mcpCheckFolder(project, tmpDir, 'change')

    expect(refused.ok === false && refused.error).toMatch(/before changing its servers/)
  })
})

// Shaped like real `claude mcp get` output (Claude Code 2.1.328, 2026-11-19); a configured server
// also prints its URL or command line, credentials included.
const GET_OUTPUT = [
  'api:',
  '  Scope: User config (available in all your projects)',
  '  Status: ! Needs authentication',
  '  Type: http',
  '  URL: https://api.example.dev/mcp?token=SECRET',
  ''
].join('\n')

describe('parseMcpGetStatus', () => {
  it("reads the server's status line", () => {
    expect(parseMcpGetStatus(GET_OUTPUT)).toBe('needs_auth')
    expect(
      parseMcpGetStatus('claude.ai Lovable:\n  Scope: claude.ai config\n  Status: ✔ Connected')
    ).toBe('connected')
  })

  it('reads nothing from output without a status line it knows', () => {
    expect(parseMcpGetStatus('api:\n  URL: https://x.dev - ✔ Connected')).toBeNull()
    expect(parseMcpGetStatus('api:\n  Status: Warming up')).toBeNull()
  })
})

describe('checkMcpServer', () => {
  beforeEach(() => mockedRunClaude.mockReset())

  it('runs claude mcp get for exactly that name from the given folder', async () => {
    mockedRunClaude.mockResolvedValue({ ok: true, stdout: GET_OUTPUT })

    const result = await checkMcpServer('-my api', '/work/repo')

    expect(mockedRunClaude).toHaveBeenCalledWith(
      ['mcp', 'get', '--', '-my api'],
      expect.objectContaining({ cwd: '/work/repo' })
    )
    expect(result).toEqual({ ok: true, status: 'needs_auth' })
  })

  it('reports output it cannot read, and passes a CLI failure through', async () => {
    mockedRunClaude.mockResolvedValueOnce({ ok: true, stdout: 'api:\n' })
    mockedRunClaude.mockResolvedValueOnce({ ok: false, error: 'No MCP server named "api"' })

    expect(await checkMcpServer('api', '/w')).toMatchObject({ ok: false })
    expect(await checkMcpServer('api', '/w')).toEqual({
      ok: false,
      error: 'No MCP server named "api"'
    })
  })
})

describe('checkMcpConnections', () => {
  let tmpDir: string

  beforeEach(() => {
    mockedRunClaude.mockReset()
    resetMcpChecks()
    tmpDir = mkdtempSync(join(tmpdir(), 'megatron-mcp-run-'))
  })

  afterEach(() => {
    resetGrantedPaths()
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('runs claude mcp list from the folder and keeps the result for the session', async () => {
    mockedRunClaude.mockResolvedValue({ ok: true, stdout: LIST_OUTPUT })

    const result = await checkMcpConnections(null, tmpDir)

    expect(mockedRunClaude).toHaveBeenCalledWith(
      ['mcp', 'list'],
      expect.objectContaining({ cwd: join(tmpDir, 'mcp-check'), timeoutMs: 120_000 })
    )
    expect(result.ok && result.check.projectPath).toBeNull()
    expect(result.ok && result.check.servers).toHaveLength(10)
    expect(latestMcpChecks().general).toEqual(result.ok ? result.check : null)
  })

  it('reads an empty server list as a successful check', async () => {
    mockedRunClaude.mockResolvedValue({
      ok: true,
      stdout: 'No MCP servers configured. Use `claude mcp add` to add a server.\n'
    })

    const result = await checkMcpConnections(null, tmpDir)

    expect(result.ok && result.check.servers).toEqual([])
  })

  it('reports output it cannot read rather than an empty list', async () => {
    mockedRunClaude.mockResolvedValue({
      ok: true,
      stdout: 'Welcome to Claude Code v9\nsomething else'
    })

    const result = await checkMcpConnections(null, tmpDir)

    expect(result).toMatchObject({ ok: false })
    expect(latestMcpChecks().general).toBeNull()
  })

  it('passes a CLI failure through and keeps the last good check', async () => {
    mockedRunClaude.mockResolvedValueOnce({ ok: true, stdout: LIST_OUTPUT })
    await checkMcpConnections(null, tmpDir)
    mockedRunClaude.mockResolvedValueOnce({ ok: false, error: 'Claude Code CLI was not found.' })

    expect(await checkMcpConnections(null, tmpDir)).toEqual({
      ok: false,
      error: 'Claude Code CLI was not found.'
    })
    expect(latestMcpChecks().general?.servers).toHaveLength(10)
  })

  it('shares one run between overlapping checks of the same folder', async () => {
    let finish: (stdout: string) => void = () => undefined
    mockedRunClaude.mockReturnValue(
      new Promise((resolve) => {
        finish = (stdout) => resolve({ ok: true, stdout })
      })
    )

    const first = checkMcpConnections(null, tmpDir)
    const second = checkMcpConnections(null, tmpDir)
    finish(LIST_OUTPUT)
    await Promise.all([first, second])

    expect(mockedRunClaude).toHaveBeenCalledTimes(1)
  })

  it('keeps project checks apart from the general one, latest per project', async () => {
    const project = join(tmpDir, 'repo')
    mkdirSync(project)
    grantPath(project)
    mockedRunClaude.mockResolvedValue({ ok: true, stdout: 'api: x - ✔ Connected' })

    await checkMcpConnections(project, tmpDir)
    await checkMcpConnections(project, tmpDir)

    expect(latestMcpChecks().general).toBeNull()
    expect(latestMcpChecks().projects.map((check) => check.projectPath)).toEqual([project])
  })

  it('never runs the CLI for a project it refuses', async () => {
    const result = await checkMcpConnections(join(tmpDir, 'ungranted'), tmpDir)

    expect(result).toMatchObject({ ok: false })
    expect(mockedRunClaude).not.toHaveBeenCalled()
  })

  // After a remove or logout every kept status may be wrong, so none is shown as current.
  it('forgets every kept check, general and per project', async () => {
    const project = join(tmpDir, 'repo')
    mkdirSync(project)
    grantPath(project)
    mockedRunClaude.mockResolvedValue({ ok: true, stdout: 'api: x - ✔ Connected' })
    await checkMcpConnections(null, tmpDir)
    await checkMcpConnections(project, tmpDir)

    forgetMcpChecks()

    expect(latestMcpChecks()).toEqual({ general: null, projects: [] })
  })
})
