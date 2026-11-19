import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runClaude } from './claude-process'
import {
  isMcpDeclarationRef,
  MCP_RESET_ARGS,
  mcpActionsIdle,
  mcpLogoutArgs,
  mcpRemoveArgs,
  runMcpAction
} from './mcp-actions'

vi.mock('./claude-process', () => ({ runClaude: vi.fn() }))
const mockedRunClaude = vi.mocked(runClaude)

beforeEach(() => mockedRunClaude.mockReset())

describe('MCP command arguments', () => {
  // `--` ends the options, so a name starting with `-` (or holding spaces) stays one operand.
  it('names the exact scope and passes the name after --', () => {
    expect(mcpRemoveArgs('-my server', 'project')).toEqual([
      'mcp',
      'remove',
      '--scope',
      'project',
      '--',
      '-my server'
    ])
    expect(mcpLogoutArgs('-my server')).toEqual(['mcp', 'logout', '--', '-my server'])
    expect(MCP_RESET_ARGS).toEqual(['mcp', 'reset-project-choices'])
  })
})

describe('runMcpAction', () => {
  afterEach(() => vi.useRealTimers())

  it('runs the CLI from the given folder with a 5-minute limit', async () => {
    mockedRunClaude.mockResolvedValue({ ok: true, stdout: 'Removed' })

    const result = await runMcpAction(['mcp', 'reset-project-choices'], '/work/repo')

    expect(result).toEqual({ ok: true, stdout: 'Removed' })
    expect(mockedRunClaude).toHaveBeenCalledWith(
      ['mcp', 'reset-project-choices'],
      expect.objectContaining({ cwd: '/work/repo', timeoutMs: 300_000 })
    )
  })

  it('passes a CLI failure through, and turns a launch error into one', async () => {
    mockedRunClaude.mockResolvedValueOnce({ ok: false, error: 'No MCP server named "x"' })
    mockedRunClaude.mockRejectedValueOnce(new Error('spawn EPERM'))

    expect(await runMcpAction(['mcp'], '/w')).toEqual({
      ok: false,
      error: 'No MCP server named "x"'
    })
    expect(await runMcpAction(['mcp'], '/w')).toEqual({ ok: false, error: 'spawn EPERM' })
  })

  // Every MCP command can write the same .claude.json, so two never run at once.
  it('refuses a second action while one is running, whatever server it names', async () => {
    let finish: () => void = () => {}
    mockedRunClaude.mockReturnValueOnce(
      new Promise((resolve) => (finish = () => resolve({ ok: true, stdout: '' })))
    )

    const first = runMcpAction(mcpRemoveArgs('a', 'user'), '/w')
    const second = await runMcpAction(mcpLogoutArgs('b'), '/w')
    finish()

    expect(second).toEqual({ ok: false, error: expect.stringMatching(/Another MCP action/) })
    expect(await first).toEqual({ ok: true, stdout: '' })
    expect(mockedRunClaude).toHaveBeenCalledTimes(1)
  })
})

describe('mcpActionsIdle', () => {
  it('resolves at once with nothing running', async () => {
    await expect(mcpActionsIdle()).resolves.toBeUndefined()
  })

  it('waits for the running action to finish', async () => {
    let finish: () => void = () => {}
    mockedRunClaude.mockReturnValueOnce(
      new Promise((resolve) => (finish = () => resolve({ ok: true, stdout: '' })))
    )
    const running = runMcpAction(MCP_RESET_ARGS, '/w')
    let idle = false
    const waiting = mcpActionsIdle().then(() => (idle = true))

    await Promise.resolve()
    expect(idle).toBe(false)
    finish()
    await running
    await waiting
    expect(idle).toBe(true)
  })
})

describe('isMcpDeclarationRef', () => {
  it('accepts a user declaration without a project and a local one with an absolute project', () => {
    expect(
      isMcpDeclarationRef({ serverId: 'configured:a b', scope: 'user', projectPath: null })
    ).toBe(true)
    expect(
      isMcpDeclarationRef({
        serverId: 'configured:api',
        scope: 'local',
        projectPath: process.platform === 'win32' ? 'C:\\repo' : '/repo'
      })
    ).toBe(true)
  })

  it.each([
    [
      'a user declaration with a project',
      { serverId: 'configured:a', scope: 'user', projectPath: '/r' }
    ],
    [
      'a project declaration without one',
      { serverId: 'configured:a', scope: 'project', projectPath: null }
    ],
    ['a relative project', { serverId: 'configured:a', scope: 'local', projectPath: 'repo' }],
    ['the plugin scope', { serverId: 'plugin:p:s', scope: 'plugin', projectPath: null }],
    ['an empty id', { serverId: '', scope: 'user', projectPath: null }],
    ['an over-long id', { serverId: 'x'.repeat(1025), scope: 'user', projectPath: null }],
    ['a NUL in the id', { serverId: 'configured:a\0b', scope: 'user', projectPath: null }],
    ['a non-object', 'configured:a']
  ])('rejects %s', (_label, input) => {
    expect(isMcpDeclarationRef(input)).toBe(false)
  })
})
