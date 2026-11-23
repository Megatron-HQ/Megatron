import { execFile } from 'child_process'
import Store from 'electron-store'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveClaudeCommand } from './claude-cli'
import { createClaudeFolder } from './claude-folder'
import { gateClaude, runClaude } from './claude-process'

vi.mock('child_process', () => ({ execFile: vi.fn() }))
vi.mock('./claude-cli', () => ({ resolveClaudeCommand: vi.fn() }))

type NodeCallback = (error: Error | null, stdout: string, stderr: string) => void

const mockedExecFile = vi.mocked(execFile)
const mockedResolve = vi.mocked(resolveClaudeCommand)

function respond(error: (Error & { code?: string; killed?: boolean }) | null, stdout = ''): void {
  mockedExecFile.mockImplementation(((...args: unknown[]) => {
    const callback = args[args.length - 1] as NodeCallback
    callback(error, stdout, '')
  }) as typeof execFile)
}

const options = { timeoutMs: 60_000, timeoutMessage: 'Took too long.' }

beforeEach(() => {
  gateClaude(() => null)
  mockedExecFile.mockReset()
  mockedResolve.mockReturnValue({
    executable: '/trusted/claude',
    prefixArguments: ['/trusted/cli.js'],
    environment: { PATH: '/trusted' }
  })
})

describe('runClaude', () => {
  it('returns stdout and runs the resolved command with the requested limits', async () => {
    respond(null, '{"is_error":false}')
    await expect(
      runClaude(['-p', '/context'], { ...options, cwd: '/baseline', maxBuffer: 10_000_000 })
    ).resolves.toEqual({ ok: true, stdout: '{"is_error":false}' })
    expect(mockedResolve).toHaveBeenCalledWith('/baseline')
    expect(mockedExecFile).toHaveBeenCalledWith(
      '/trusted/claude',
      ['/trusted/cli.js', '-p', '/context'],
      {
        shell: false,
        windowsHide: true,
        timeout: 60_000,
        maxBuffer: 10_000_000,
        env: { PATH: '/trusted' },
        cwd: '/baseline'
      },
      expect.any(Function)
    )
  })

  it("writes the caller's input to the CLI's stdin and closes it", async () => {
    const end = vi.fn()
    const on = vi.fn()
    mockedExecFile.mockImplementation(((...args: unknown[]) => {
      const callback = args[args.length - 1] as NodeCallback
      setImmediate(() => callback(null, 'added', ''))
      return { stdin: { end, on } }
    }) as unknown as typeof execFile)

    await expect(runClaude(['mcp', 'add-json'], { ...options, stdin: '{"a":1}' })).resolves.toEqual(
      { ok: true, stdout: 'added' }
    )
    expect(end).toHaveBeenCalledWith('{"a":1}')
    // A CLI that exits before reading its input makes stdin emit EPIPE, which must not crash
    // main; the run's own result reports the failure.
    expect(on).toHaveBeenCalledWith('error', expect.any(Function))
  })

  it("reports the caller's timeout message when the run is killed", async () => {
    respond(Object.assign(new Error('killed'), { killed: true }))
    await expect(runClaude(['-p', '/context'], options)).resolves.toEqual({
      ok: false,
      error: 'Took too long.'
    })
  })

  it('reports a missing CLI without spawning anything', async () => {
    mockedResolve.mockReturnValue(null)
    const result = await runClaude(['-p', '/context'], options)
    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toMatch(/Claude Code CLI was not found/)
    expect(mockedExecFile).not.toHaveBeenCalled()
  })

  it('asks the gate on every run, and refuses while it gives a reason', async () => {
    respond(null, 'ok')
    let reason: string | null = 'The Claude Code folder is missing.'
    gateClaude(() => reason)
    await expect(runClaude(['plugin', 'enable', 'demo'], options)).resolves.toEqual({
      ok: false,
      error: 'The Claude Code folder is missing.'
    })
    expect(mockedExecFile).not.toHaveBeenCalled()
    reason = null
    await expect(runClaude(['-p', '/context'], options)).resolves.toEqual({
      ok: true,
      stdout: 'ok'
    })
  })

  it('refuses a run against a named folder removed after startup, before any poll fires', async () => {
    const home = realpathSync(mkdtempSync(join(tmpdir(), 'megatron-claude-process-')))
    try {
      const work = join(home, '.claude-work')
      mkdirSync(work)
      writeFileSync(join(work, 'settings.json'), '{}')
      const folder = createClaudeFolder({
        home,
        environment: work,
        isPrimaryInstance: true,
        store: new Store({ name: 'preferences', cwd: join(home, 'userData') }),
        watch: () => {},
        cliActionsIdle: async () => {},
        stopScans: async () => {},
        suspendScans: async () => {},
        resumeScans: () => {},
        relaunch: () => {},
        broadcast: () => {},
        onResume: () => {}
      })
      gateClaude(folder.cliRefusal)
      respond(null, 'ok')

      rmSync(work, { recursive: true })
      const result = await runClaude(['plugin', 'enable', 'demo'], options)
      expect(result).toEqual({ ok: false, error: expect.stringContaining(work) })
      expect(mockedExecFile).not.toHaveBeenCalled()
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })
})
