import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runClaude } from './claude-process'
import { grantPath, resetGrantedPaths } from './permissions'
import {
  checkMcpConnections,
  latestMcpChecks,
  mcpCheckFolder,
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
})
