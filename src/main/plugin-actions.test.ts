import { execFile } from 'child_process'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { disablePlugin, enablePlugin, uninstallPlugin, updatePlugin } from './plugin-actions'

vi.mock('child_process', () => ({ execFile: vi.fn() }))

type NodeCallback = (error: Error | null, stdout: string, stderr: string) => void

const mockedExecFile = vi.mocked(execFile)
const claudeOptions = {
  shell: process.platform === 'win32',
  timeout: 300_000,
  windowsHide: true
}

function succeed(): void {
  mockedExecFile.mockImplementation(((...args: unknown[]) => {
    const callback = args[args.length - 1] as NodeCallback
    callback(null, '', '')
  }) as typeof execFile)
}

function fail(stderr: string): void {
  mockedExecFile.mockImplementation(((...args: unknown[]) => {
    const callback = args[args.length - 1] as NodeCallback
    callback(new Error('exit 1'), '', stderr)
  }) as typeof execFile)
}

function failWith(error: Error & { code?: string; killed?: boolean }, stderr = ''): void {
  mockedExecFile.mockImplementation(((...args: unknown[]) => {
    const callback = args[args.length - 1] as NodeCallback
    callback(error, '', stderr)
  }) as typeof execFile)
}

const input = { name: 'ponytail', marketplace: 'claude-plugins-official', scope: 'user' as const }

beforeEach(() => {
  mockedExecFile.mockReset()
})

describe('enablePlugin', () => {
  it('invokes claude plugin enable with the plugin id and explicit scope', async () => {
    succeed()
    await enablePlugin(input)
    expect(mockedExecFile).toHaveBeenCalledWith(
      'claude',
      ['plugin', 'enable', 'ponytail@claude-plugins-official', '--scope', 'user'],
      claudeOptions,
      expect.any(Function)
    )
  })
})

describe('disablePlugin', () => {
  it('invokes claude plugin disable with the plugin id and explicit scope', async () => {
    succeed()
    await disablePlugin(input)
    expect(mockedExecFile).toHaveBeenCalledWith(
      'claude',
      ['plugin', 'disable', 'ponytail@claude-plugins-official', '--scope', 'user'],
      claudeOptions,
      expect.any(Function)
    )
  })
})

describe('updatePlugin', () => {
  it('invokes claude plugin update with -y, since Megatron is never a TTY', async () => {
    succeed()
    await updatePlugin(input)
    expect(mockedExecFile).toHaveBeenCalledWith(
      'claude',
      ['plugin', 'update', 'ponytail@claude-plugins-official', '--scope', 'user', '-y'],
      claudeOptions,
      expect.any(Function)
    )
  })
})

describe('uninstallPlugin', () => {
  it('invokes claude plugin uninstall with -y, since Megatron is never a TTY', async () => {
    succeed()
    await uninstallPlugin(input)
    expect(mockedExecFile).toHaveBeenCalledWith(
      'claude',
      ['plugin', 'uninstall', 'ponytail@claude-plugins-official', '--scope', 'user', '-y'],
      claudeOptions,
      expect.any(Function)
    )
  })
})

describe('action result', () => {
  it('resolves ok: true on success', async () => {
    succeed()
    expect(await enablePlugin(input)).toEqual({ ok: true })
  })

  it('resolves ok: false with the real stderr text on failure', async () => {
    fail('Error: plugin not found')
    expect(await enablePlugin(input)).toEqual({ ok: false, stderr: 'Error: plugin not found' })
  })

  it('explains how to recover when the Claude Code CLI is unavailable', async () => {
    failWith(Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' }))

    await expect(enablePlugin(input)).resolves.toEqual({
      ok: false,
      stderr:
        'Claude Code CLI was not found. Install Claude Code and ensure `claude` is on your PATH.'
    })
  })

  it('reports a timed out command instead of leaving the action unresolved', async () => {
    failWith(Object.assign(new Error('Command failed'), { killed: true }))

    await expect(enablePlugin(input)).resolves.toEqual({
      ok: false,
      stderr: 'Claude Code did not finish within 5 minutes. Check your connection and try again.'
    })
  })

  it('rejects plugin details containing Windows shell control characters', async () => {
    succeed()

    await expect(enablePlugin({ ...input, name: 'ponytail&other' })).resolves.toEqual({
      ok: false,
      stderr:
        'Plugin details contain unsupported characters. Refresh the plugin list and try again.'
    })
    expect(mockedExecFile).not.toHaveBeenCalled()
  })

  it('rejects a second action while the same plugin command is still running', async () => {
    let completeFirstAction: NodeCallback | undefined
    mockedExecFile.mockImplementation(((...args: unknown[]) => {
      const callback = args[args.length - 1] as NodeCallback
      if (!completeFirstAction) {
        completeFirstAction = callback
        return
      }
      callback(null, '', '')
    }) as typeof execFile)

    const firstAction = enablePlugin(input)

    await expect(disablePlugin(input)).resolves.toEqual({
      ok: false,
      stderr: 'Another action is already running for this plugin. Wait for it to finish.'
    })
    expect(mockedExecFile).toHaveBeenCalledTimes(1)

    completeFirstAction?.(null, '', '')
    await expect(firstAction).resolves.toEqual({ ok: true })
  })
})
