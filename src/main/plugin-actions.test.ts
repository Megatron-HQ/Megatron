import { execFile } from 'child_process'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { disablePlugin, enablePlugin, uninstallPlugin, updatePlugin } from './plugin-actions'

vi.mock('child_process', () => ({ execFile: vi.fn() }))

type NodeCallback = (error: Error | null, stdout: string, stderr: string) => void

const mockedExecFile = vi.mocked(execFile)

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
})
