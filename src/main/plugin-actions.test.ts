import { execFile } from 'child_process'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { grantPath, resetGrantedPaths } from './permissions'
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

const input = {
  name: 'ponytail',
  marketplace: 'claude-plugins-official',
  scope: 'user' as const,
  projectPath: null
}

let projectRoot: string

beforeEach(() => {
  mockedExecFile.mockReset()
  projectRoot = mkdtempSync(join(tmpdir(), 'megatron-plugin-action-'))
  grantPath(projectRoot)
})

afterEach(() => {
  resetGrantedPaths()
  rmSync(projectRoot, { recursive: true, force: true })
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

describe('project and local scope', () => {
  // Verified against the real CLI: `claude plugin list` from a project reports its plugins
  // enabled, the same command from $HOME reports them disabled. Scope resolution is entirely
  // cwd-driven, so the working directory is the whole mechanism.
  it('runs the CLI from the project directory for a project-scope action', async () => {
    succeed()
    await enablePlugin({ ...input, scope: 'project', projectPath: projectRoot })

    expect(mockedExecFile).toHaveBeenCalledWith(
      'claude',
      ['plugin', 'enable', 'ponytail@claude-plugins-official', '--scope', 'project'],
      { ...claudeOptions, cwd: projectRoot },
      expect.any(Function)
    )
  })

  it('runs the CLI from the project directory for a local-scope action', async () => {
    succeed()
    await uninstallPlugin({ ...input, scope: 'local', projectPath: projectRoot })

    expect(mockedExecFile).toHaveBeenCalledWith(
      'claude',
      ['plugin', 'uninstall', 'ponytail@claude-plugins-official', '--scope', 'local', '-y'],
      { ...claudeOptions, cwd: projectRoot },
      expect.any(Function)
    )
  })

  // A project/local entry Claude Code wrote without a projectPath has no directory to run from,
  // and Megatron's own cwd would silently resolve to a different project.
  it('refuses a project-scope action with no project path', async () => {
    succeed()

    await expect(enablePlugin({ ...input, scope: 'project', projectPath: null })).resolves.toEqual({
      ok: false,
      stderr:
        "This install doesn't record which project it belongs to, so Megatron can't tell the Claude Code CLI where to run."
    })
    expect(mockedExecFile).not.toHaveBeenCalled()
  })

  // Without the grant its .claude/settings*.json is unreadable, so the UI is showing Unknown —
  // offering Disable there would be flipping a switch whose current position we can't see.
  it('refuses a project-scope action when the project folder is not granted', async () => {
    succeed()
    const ungranted = mkdtempSync(join(tmpdir(), 'megatron-ungranted-action-'))
    try {
      await expect(
        enablePlugin({ ...input, scope: 'project', projectPath: ungranted })
      ).resolves.toEqual({
        ok: false,
        stderr:
          "Grant this plugin's project folder in Manage Folders before changing it, so Megatron can read the result."
      })
      expect(mockedExecFile).not.toHaveBeenCalled()
    } finally {
      rmSync(ungranted, { recursive: true, force: true })
    }
  })

  it('never passes a cwd for a user-scope action', async () => {
    succeed()
    await enablePlugin(input)

    expect(mockedExecFile).toHaveBeenCalledWith(
      'claude',
      expect.anything(),
      claudeOptions,
      expect.any(Function)
    )
  })

  // The in-flight guard used to key on name@marketplace alone, which meant disabling a project
  // install blocked the user install of the same plugin — two genuinely independent switches.
  it('allows a user and a project action on one plugin to run at the same time', async () => {
    let completeFirstAction: NodeCallback | undefined
    mockedExecFile.mockImplementation(((...args: unknown[]) => {
      const callback = args[args.length - 1] as NodeCallback
      if (!completeFirstAction) {
        completeFirstAction = callback
        return
      }
      callback(null, '', '')
    }) as typeof execFile)

    const userAction = enablePlugin(input)

    await expect(
      disablePlugin({ ...input, scope: 'project', projectPath: projectRoot })
    ).resolves.toEqual({ ok: true })
    expect(mockedExecFile).toHaveBeenCalledTimes(2)

    completeFirstAction?.(null, '', '')
    await expect(userAction).resolves.toEqual({ ok: true })
  })

  it('still blocks a second action on the very same install', async () => {
    mockedExecFile.mockImplementation((() => {}) as unknown as typeof execFile)
    const projectInput = { ...input, scope: 'project' as const, projectPath: projectRoot }

    void enablePlugin(projectInput)

    await expect(disablePlugin(projectInput)).resolves.toEqual({
      ok: false,
      stderr: 'Another action is already running for this plugin. Wait for it to finish.'
    })
    expect(mockedExecFile).toHaveBeenCalledTimes(1)
  })

  it('treats two projects installing one plugin as independent installs', async () => {
    const otherRoot = mkdtempSync(join(tmpdir(), 'megatron-plugin-action-b-'))
    grantPath(otherRoot)
    try {
      mockedExecFile.mockImplementation((() => {}) as unknown as typeof execFile)

      void enablePlugin({ ...input, scope: 'project', projectPath: projectRoot })
      void enablePlugin({ ...input, scope: 'project', projectPath: otherRoot })

      expect(mockedExecFile).toHaveBeenCalledTimes(2)
    } finally {
      rmSync(otherRoot, { recursive: true, force: true })
    }
  })
})
