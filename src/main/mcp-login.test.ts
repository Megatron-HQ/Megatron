import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it, vi, type Mock } from 'vitest'
import { EventEmitter } from 'node:events'
import {
  macosLoginScript,
  mcpLoginArgs,
  openLoginTerminal,
  windowsLoginLaunch,
  type LoginTerminalDependencies
} from './mcp-login'

const NATIVE = { executable: 'C:\\Users\\me\\.local\\bin\\claude.exe', prefixArguments: [] }
const NPM = {
  executable: '/opt/homebrew/bin/node',
  prefixArguments: ['/opt/homebrew/lib/node_modules/@anthropic-ai/claude-code/cli.js']
}

function decodeCommand(args: string[]): string {
  const encoded = args[args.indexOf('-EncodedCommand') + 1]
  return Buffer.from(encoded, 'base64').toString('utf16le')
}

function decodeWindowsTerminalCommand(args: string[]): string {
  const encoded = /'-EncodedCommand', '([\w+/=]+)'/.exec(decodeCommand(args))?.[1]
  expect(encoded).toBeDefined()
  return Buffer.from(encoded ?? '', 'base64').toString('utf16le')
}

describe('mcpLoginArgs', () => {
  it('ends the options before the name, which may start with -', () => {
    expect(mcpLoginArgs('-odd')).toEqual(['mcp', 'login', '--', '-odd'])
  })
})

describe('windowsLoginLaunch', () => {
  it("runs Windows PowerShell from System32, never one a project's PATH could supply", () => {
    const launch = windowsLoginLaunch(NATIVE, 'github', 'C:\\Windows')
    expect(launch.file).toBe('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
    expect(launch.args.slice(0, 3)).toEqual(['-NoProfile', '-NonInteractive', '-EncodedCommand'])
    expect(decodeCommand(launch.args)).toContain(`Start-Process -FilePath '${launch.file}'`)
    expect(decodeCommand(launch.args)).toContain("'-NoExit'")
  })

  it('passes every value as a single-quoted literal, so a quote in a name or path stays text', () => {
    const script = decodeWindowsTerminalCommand(
      windowsLoginLaunch(
        { executable: "C:\\it's\\claude.exe", prefixArguments: [] },
        "claude.ai Notion (work's)",
        'C:\\Windows'
      ).args
    )
    expect(script).toContain(
      "& 'C:\\it''s\\claude.exe' 'mcp' 'login' '--' 'claude.ai Notion (work''s)'"
    )
  })
})

describe('macosLoginScript', () => {
  it('deletes itself, enters the folder, and runs the resolved claude with the name quoted', () => {
    const script = macosLoginScript(NPM, "it's", '/Users/me/repo', undefined)
    const lines = script.split('\n')
    expect(lines[0]).toBe('#!/bin/sh')
    expect(lines[1]).toBe('rm -f -- "$0"')
    expect(script).toContain("cd -- '/Users/me/repo' || exit 1")
    expect(script).toContain(
      "'/opt/homebrew/bin/node' '/opt/homebrew/lib/node_modules/@anthropic-ai/claude-code/cli.js' 'mcp' 'login' '--' 'it'\\''s'"
    )
  })

  it("points Claude Code at Megatron's folder, never one the shell profile names", () => {
    expect(macosLoginScript(NATIVE, 'a', '/x', '/Users/me/.claude-work')).toContain(
      "export CLAUDE_CONFIG_DIR='/Users/me/.claude-work'"
    )
    expect(macosLoginScript(NATIVE, 'a', '/x', undefined)).toContain('unset CLAUDE_CONFIG_DIR')
  })
})

function dependencies(
  platform: NodeJS.Platform,
  outcome: 'launch' | 'exit-failure' | 'error' = 'launch'
): LoginTerminalDependencies & {
  spawn: Mock<LoginTerminalDependencies['spawn']>
  writeFile: Mock<LoginTerminalDependencies['writeFile']>
  removeFile: Mock<LoginTerminalDependencies['removeFile']>
} {
  const child = Object.assign(new EventEmitter(), { unref: vi.fn() })
  return {
    platform,
    command: { ...NATIVE, environment: { PATH: 'C:\\trusted', CLAUDE_CONFIG_DIR: 'C:\\cfg' } },
    systemRoot: 'C:\\Windows',
    scriptFolder: '/private/megatron',
    spawn: vi.fn<LoginTerminalDependencies['spawn']>(() => {
      setImmediate(() => {
        if (outcome === 'error') {
          child.emit('error', new Error('spawn ENOENT'))
          return
        }
        child.emit('spawn')
        child.emit('exit', outcome === 'exit-failure' ? 1 : 0)
      })
      return child
    }),
    writeFile: vi.fn<LoginTerminalDependencies['writeFile']>(),
    removeFile: vi.fn<LoginTerminalDependencies['removeFile']>(),
    randomName: () => 'abc123'
  }
}
describe('openLoginTerminal', () => {
  it('opens its own console window on Windows, in the folder, with the resolved environment', async () => {
    const deps = dependencies('win32')
    await expect(openLoginTerminal('github', 'C:\\repo', deps)).resolves.toEqual({ ok: true })
    const [file, args, options] = deps.spawn.mock.calls[0]
    expect(file).toMatch(/powershell\.exe$/)
    expect(decodeWindowsTerminalCommand(args)).toContain("'login' '--' 'github'")
    expect(options).toMatchObject({
      cwd: 'C:\\repo',
      env: { PATH: 'C:\\trusted', CLAUDE_CONFIG_DIR: 'C:\\cfg' },
      detached: false,
      stdio: 'ignore',
      windowsHide: true
    })
  })

  it('reports a Windows launcher failure even if PowerShell itself started', async () => {
    const result = await openLoginTerminal(
      'github',
      'C:\\repo',
      dependencies('win32', 'exit-failure')
    )
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('claude mcp login') })
  })

  it.each(['exit-failure', 'error'] as const)(
    'reports a macOS open that %s and removes the script nobody will run',
    async (outcome) => {
      const deps = dependencies('darwin', outcome)
      const result = await openLoginTerminal('github', '/Users/me/repo', deps)
      expect(result).toMatchObject({
        ok: false,
        error: expect.stringContaining('claude mcp login')
      })
      expect(deps.removeFile).toHaveBeenCalledWith(
        '/private/megatron/megatron-mcp-login-abc123.command'
      )
    }
  )

  it('writes a private one-shot script on macOS and opens it in Terminal', async () => {
    const deps = dependencies('darwin')
    await expect(openLoginTerminal('github', '/Users/me/repo', deps)).resolves.toEqual({ ok: true })
    const [path, text, mode] = deps.writeFile.mock.calls[0]
    expect(path).toBe('/private/megatron/megatron-mcp-login-abc123.command')
    expect(text).toContain("'login' '--' 'github'")
    expect(text).toContain("export CLAUDE_CONFIG_DIR='C:\\cfg'")
    expect(mode).toBe(0o700)
    expect(deps.spawn).toHaveBeenCalledWith(
      '/usr/bin/open',
      ['-a', 'Terminal', '/private/megatron/megatron-mcp-login-abc123.command'],
      expect.objectContaining({ detached: true, stdio: 'ignore' })
    )
  })

  it("says so when the terminal can't be started", async () => {
    const result = await openLoginTerminal('github', 'C:\\repo', dependencies('win32', 'error'))
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('claude mcp login') })
  })

  it('points other systems at the command to run themselves', async () => {
    const deps = dependencies('linux')
    const result = await openLoginTerminal('github', '/repo', deps)
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('claude mcp login') })
    expect(deps.spawn).not.toHaveBeenCalled()
  })
})

// The macOS script, run by a real POSIX shell (the macOS CI job; skipped on Windows). A stand-in for
// claude prints the folder it runs in, its arguments and the Claude Code folder it sees, so quoting,
// the folder switch, the CLAUDE_CONFIG_DIR handling and the self-delete are all checked for real.
describe.skipIf(process.platform === 'win32')('macosLoginScript in a real shell', () => {
  const STAND_IN = {
    executable: '/bin/sh',
    prefixArguments: [
      '-c',
      'pwd; printf "%s|" "$@"; echo; echo "cfg=${CLAUDE_CONFIG_DIR-unset}"',
      'claude'
    ]
  }

  function run(configDirectory: string | undefined): {
    output: string
    script: string
    cwd: string
  } {
    const folder = mkdtempSync(join(tmpdir(), "megatron login's "))
    const cwd = join(folder, "repo with 'quote")
    mkdirSync(cwd)
    const script = join(folder, 'megatron-mcp-login-test.command')
    writeFileSync(
      script,
      macosLoginScript(STAND_IN, "claude.ai Notion (work's)", cwd, configDirectory),
      { mode: 0o700 }
    )
    const output = execFileSync('/bin/sh', [script], {
      encoding: 'utf8',
      // A shell profile pointing somewhere else must never win over Megatron's folder.
      env: { ...process.env, CLAUDE_CONFIG_DIR: '/from/the/profile' }
    })
    return { output, script, cwd }
  }

  it('runs the login in the folder with every argument intact, then removes itself', () => {
    const { output, script, cwd } = run("/Users/me/claude's folder")
    expect(output.split('\n')[0]).toBe(cwd)
    expect(output).toContain("mcp|login|--|claude.ai Notion (work's)|")
    expect(output).toContain("cfg=/Users/me/claude's folder")
    expect(existsSync(script)).toBe(false)
  })

  it("clears a profile's CLAUDE_CONFIG_DIR when Megatron reads the default folder", () => {
    expect(run(undefined).output).toContain('cfg=unset')
  })
})
