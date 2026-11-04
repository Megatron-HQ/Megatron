import { execFile } from 'child_process'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolveClaudeCommand } from './claude-cli'
import { runClaude } from './claude-process'

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
})
