import { describe, expect, it, vi, type Mocked } from 'vitest'
import type {
  McpAddInput,
  McpDeclarationRef,
  McpLiveStatus,
  McpLoginRef,
  ScanSummary
} from '../shared/ipc'
import type { McpActionTarget, McpResetTarget } from './db/mcp-queries'
import { createMcpActionService, type McpActionDependencies } from './mcp-action-service'

const REF: McpDeclarationRef = {
  serverId: 'configured:my api',
  scope: 'local',
  projectPath: '/repo'
}
const TARGET: McpActionTarget = { ok: true, name: 'my api', scope: 'local', projectPath: '/repo' }
const GONE: McpActionTarget = { ok: false, error: 'my api has no local declaration' }

function summary(status: 'complete' | 'partial' | 'failed', codes: string[] = []): ScanSummary {
  return {
    outcome: status,
    completedAt: '2026-11-19T00:00:00.000Z',
    sources: [
      {
        name: 'scanMcpDeclarations',
        status,
        issues: codes.map((code) => ({ code: code as 'permission_required', path: '/x' }))
      }
    ]
  }
}

interface Fakes {
  deps: Mocked<McpActionDependencies>
  service: ReturnType<typeof createMcpActionService>
}

function fakes(
  overrides: {
    targets?: McpActionTarget[]
    reset?: McpResetTarget
    folder?: { ok: true; cwd: string } | { ok: false; error: string }
    run?: { ok: true; stdout: string } | { ok: false; error: string }
    scan?: ScanSummary | Error
    status?: { ok: true; status: McpLiveStatus } | { ok: false; error: string }
    conflict?: string | null
    found?: { serverId: string; approval: 'approved' | 'rejected' | 'pending' | null } | null
    lookup?: 'found' | 'missing' | 'unknown'
    precedence?: string | null
    loginTarget?:
      { ok: true; name: string; projectPath: string | null } | { ok: false; error: string }
    terminal?: { ok: true } | { ok: false; error: string }
  } = {}
): Fakes {
  const targets = [...(overrides.targets ?? [TARGET, GONE])]
  const deps: Mocked<McpActionDependencies> = {
    target: vi.fn(() => targets.shift() ?? GONE),
    resetTarget: vi.fn(
      () =>
        overrides.reset ?? {
          ok: true as const,
          projectPath: '/repo',
          approvals: { approved: 2, pending: 0, rejected: 1 }
        }
    ),
    approvals: vi.fn(() => ({ approved: 1, pending: 3, rejected: 0 })),
    folder: vi.fn(() => overrides.folder ?? { ok: true as const, cwd: '/repo' }),
    run: vi.fn(async () => overrides.run ?? { ok: true as const, stdout: '' }),
    refresh: vi.fn(async () => {
      if (overrides.scan instanceof Error) throw overrides.scan
      return overrides.scan ?? summary('complete')
    }),
    serverStatus: vi.fn(
      async () => overrides.status ?? { ok: true as const, status: 'needs_auth' as const }
    ),
    forgetChecks: vi.fn(),
    reportError: vi.fn(),
    addConflict: vi.fn(() => overrides.conflict ?? null),
    findDeclaration: vi.fn(() =>
      overrides.found === undefined
        ? { serverId: 'configured:github', approval: null }
        : overrides.found
    ),
    lookupCommand: vi.fn(() => overrides.lookup ?? 'found'),
    precedenceNote: vi.fn(() => overrides.precedence ?? null),
    loginTarget: vi.fn(
      () => overrides.loginTarget ?? { ok: true as const, name: 'sentry', projectPath: '/repo' }
    ),
    openLoginTerminal: vi.fn(async () => overrides.terminal ?? { ok: true as const })
  }
  return { deps, service: createMcpActionService(deps) }
}

describe('remove', () => {
  it('removes the indexed declaration from its own folder and confirms it is gone', async () => {
    const { deps, service } = fakes()

    const result = await service.remove(REF)

    expect(deps.target).toHaveBeenCalledWith(REF, 'remove')
    expect(deps.folder).toHaveBeenCalledWith('/repo')
    expect(deps.run).toHaveBeenCalledWith(
      ['mcp', 'remove', '--scope', 'local', '--', 'my api'],
      '/repo'
    )
    expect(deps.forgetChecks).toHaveBeenCalled()
    expect(result).toEqual({ ok: true, message: 'Removed my api from local scope.' })
  })

  it('runs a user-scope remove from the app-private folder', async () => {
    const { deps, service } = fakes({
      targets: [{ ok: true, name: 'api', scope: 'user', projectPath: null }, GONE],
      folder: { ok: true, cwd: '/data/mcp-check' }
    })

    await service.remove({ serverId: 'configured:api', scope: 'user', projectPath: null })

    expect(deps.folder).toHaveBeenCalledWith(null)
    expect(deps.run).toHaveBeenCalledWith(expect.any(Array), '/data/mcp-check')
  })

  it("says so when Claude Code didn't remove the declaration", async () => {
    const { service } = fakes({ targets: [TARGET, TARGET] })

    expect(await service.remove(REF)).toEqual({
      ok: true,
      verificationError: expect.stringMatching(/my api is still declared in local scope/)
    })
  })

  it('never runs the CLI for a refused target or folder', async () => {
    const refused = fakes({ targets: [{ ok: false, error: 'Managed in claude.ai.' }] })
    const ungranted = fakes({ folder: { ok: false, error: 'Grant this folder first.' } })

    expect(await refused.service.remove(REF)).toEqual({ ok: false, error: 'Managed in claude.ai.' })
    expect(await ungranted.service.remove(REF)).toEqual({
      ok: false,
      error: 'Grant this folder first.'
    })
    expect(refused.deps.run).not.toHaveBeenCalled()
    expect(ungranted.deps.run).not.toHaveBeenCalled()
  })

  it('passes a CLI failure through without rescanning', async () => {
    const { deps, service } = fakes({ run: { ok: false, error: 'No MCP server named "my api"' } })

    expect(await service.remove(REF)).toEqual({ ok: false, error: 'No MCP server named "my api"' })
    expect(deps.refresh).not.toHaveBeenCalled()
  })

  it("can't confirm a remove the rescan didn't reread", async () => {
    for (const scan of [
      summary('failed'),
      summary('partial', ['source_unavailable']),
      new Error('x')
    ]) {
      const { deps, service } = fakes({ scan })

      expect(await service.remove(REF)).toEqual({
        ok: true,
        verificationError: expect.stringMatching(/couldn't reread/)
      })
      if (scan instanceof Error) expect(deps.reportError).toHaveBeenCalled()
    }
  })

  // A project Megatron may not read is reported by the scan, not a reason to doubt this one.
  it('accepts a rescan whose only issues are folders it may not read', async () => {
    const { service } = fakes({
      scan: summary('partial', ['permission_required', 'project_missing'])
    })

    expect(await service.remove(REF)).toMatchObject({ ok: true, message: expect.any(String) })
  })
})

describe('resetProjectChoices', () => {
  it("resets from the project and reports what's left after", async () => {
    const { deps, service } = fakes()

    const result = await service.resetProjectChoices('/repo')

    expect(deps.folder).toHaveBeenCalledWith('/repo')
    expect(deps.run).toHaveBeenCalledWith(['mcp', 'reset-project-choices'], '/repo')
    expect(deps.approvals).toHaveBeenCalledWith('/repo')
    expect(result).toEqual({
      ok: true,
      message:
        'Reset the .mcp.json choices: 3 servers wait for approval, 1 is still approved by a settings file.'
    })
  })

  it('refuses a project without readable choices, without running the CLI', async () => {
    const { deps, service } = fakes({ reset: { ok: false, error: 'No .mcp.json read here.' } })

    expect(await service.resetProjectChoices('/repo')).toEqual({
      ok: false,
      error: 'No .mcp.json read here.'
    })
    expect(deps.run).not.toHaveBeenCalled()
  })
})

describe('logout', () => {
  it('logs out and confirms the server now asks for sign-in', async () => {
    const { deps, service } = fakes()

    const result = await service.logout(REF)

    expect(deps.target).toHaveBeenCalledWith(REF, 'logout')
    expect(deps.run).toHaveBeenCalledWith(['mcp', 'logout', '--', 'my api'], '/repo')
    expect(deps.serverStatus).toHaveBeenCalledWith('my api', '/repo')
    expect(deps.forgetChecks).toHaveBeenCalled()
    expect(result).toEqual({
      ok: true,
      message: 'Logged out of my api. Claude Code will ask you to sign in again.'
    })
  })

  // A refusal exits 0 too (docs/mcp-servers.md, Connector logout), so the state decides.
  it('reports a server that still connects instead of claiming a logout', async () => {
    const { service } = fakes({ status: { ok: true, status: 'connected' } })

    expect(await service.logout(REF)).toEqual({
      ok: true,
      verificationError: expect.stringMatching(/still connects to my api/)
    })
  })

  it("says it couldn't confirm when the server can't be checked afterwards", async () => {
    const unreachable = fakes({ status: { ok: true, status: 'failed' } })
    const unreadable = fakes({ status: { ok: false, error: 'timed out' } })

    expect(await unreachable.service.logout(REF)).toMatchObject({
      verificationError: expect.stringMatching(/couldn't confirm/)
    })
    expect(await unreadable.service.logout(REF)).toMatchObject({
      verificationError: expect.stringMatching(/timed out/)
    })
  })
})

describe('add', () => {
  const INPUT: McpAddInput = {
    name: 'github',
    scope: 'user',
    projectPath: null,
    transport: 'stdio',
    command: 'uvx',
    args: ['mcp-server-github'],
    url: '',
    env: [{ name: 'GITHUB_TOKEN', value: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789' }],
    headers: []
  }

  it('runs add-json from the scope folder with the config on stdin, never in the arguments', async () => {
    const { deps, service } = fakes({ folder: { ok: true, cwd: '/app/empty' } })

    await expect(service.add(INPUT)).resolves.toEqual({
      ok: true,
      serverId: 'configured:github',
      message: 'Added github to user scope.'
    })
    expect(deps.folder).toHaveBeenCalledWith(null)
    const [args, cwd, stdin] = deps.run.mock.calls[0]
    expect(args).toEqual(['mcp', 'add-json', '--scope', 'user', '--', 'github', '-'])
    expect(args.join(' ')).not.toContain('ghp_')
    expect(cwd).toBe('/app/empty')
    expect(JSON.parse(stdin as string)).toEqual({
      type: 'stdio',
      command: 'uvx',
      args: ['mcp-server-github'],
      env: { GITHUB_TOKEN: 'ghp_abcdefghijklmnopqrstuvwxyz0123456789' }
    })
    expect(deps.forgetChecks).toHaveBeenCalled()
  })

  it('refuses a credential literal in a project .mcp.json without running anything', async () => {
    const { deps, service } = fakes()
    const result = await service.add({ ...INPUT, scope: 'project', projectPath: '/repo' })
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('GITHUB_TOKEN') })
    expect(deps.run).not.toHaveBeenCalled()
  })

  it('refuses a name the index says conflicts, without running anything', async () => {
    const { deps, service } = fakes({ conflict: 'User scope already declares github.' })
    await expect(service.add(INPUT)).resolves.toEqual({
      ok: false,
      error: 'User scope already declares github.'
    })
    expect(deps.run).not.toHaveBeenCalled()
  })

  it("refuses a project folder Megatron can't run in", async () => {
    const { deps, service } = fakes({ folder: { ok: false, error: 'Grant the folder first.' } })
    await expect(service.add({ ...INPUT, scope: 'local', projectPath: '/repo' })).resolves.toEqual({
      ok: false,
      error: 'Grant the folder first.'
    })
    expect(deps.run).not.toHaveBeenCalled()
  })

  it("passes Claude Code's refusal through", async () => {
    const { service } = fakes({ run: { ok: false, error: 'MCP server github already exists' } })
    await expect(service.add(INPUT)).resolves.toEqual({
      ok: false,
      error: 'MCP server github already exists'
    })
  })

  it("says so when Claude Code reported success but the server isn't declared", async () => {
    const { service } = fakes({ found: null })
    await expect(service.add(INPUT)).resolves.toMatchObject({
      ok: true,
      serverId: 'configured:github',
      verificationError: expect.stringContaining("doesn't find github")
    })
  })

  it("says so when the configuration couldn't be reread", async () => {
    const { service } = fakes({ scan: new Error('worker died') })
    await expect(service.add(INPUT)).resolves.toMatchObject({
      ok: true,
      verificationError: expect.stringContaining('reread')
    })
  })

  it('notes that a project server waits for approval', async () => {
    const { service } = fakes({ found: { serverId: 'configured:github', approval: 'pending' } })
    const result = await service.add({
      ...INPUT,
      env: [{ name: 'GITHUB_TOKEN', value: '${GITHUB_TOKEN}' }],
      scope: 'project',
      projectPath: '/repo'
    })
    expect(result).toMatchObject({
      ok: true,
      message: expect.stringContaining('waits for approval')
    })
  })

  it('notes which declaration of the same name takes precedence', async () => {
    const note = 'In this project it takes precedence over the user-scope github.'
    const { deps, service } = fakes({ precedence: note })
    const result = await service.add({ ...INPUT, scope: 'local', projectPath: '/repo' })
    expect(deps.precedenceNote).toHaveBeenCalledWith('github', 'local', '/repo')
    expect(result).toMatchObject({ ok: true, message: expect.stringContaining(note) })
  })

  it("notes a bare command Megatron can't find on PATH", async () => {
    const { deps, service } = fakes({ lookup: 'missing' })
    const result = await service.add(INPUT)
    expect(deps.lookupCommand).toHaveBeenCalledWith('uvx')
    expect(result).toMatchObject({ ok: true, message: expect.stringContaining("can't find uvx") })
  })
})

describe('login', () => {
  const LOGIN: McpLoginRef = { serverId: 'configured:sentry', scope: 'local', projectPath: '/repo' }

  it("opens Claude Code's login in a terminal from the Declaration's folder", async () => {
    const { deps, service } = fakes({ folder: { ok: true, cwd: '/repo' } })
    await expect(service.login(LOGIN)).resolves.toEqual({
      ok: true,
      message:
        'Finish signing in to sentry in the terminal window and your browser, then click Check sign-in.'
    })
    expect(deps.folder).toHaveBeenCalledWith('/repo')
    expect(deps.openLoginTerminal).toHaveBeenCalledWith('sentry', '/repo')
  })

  it('refuses a server that has nothing to sign in to, without opening anything', async () => {
    const { deps, service } = fakes({
      loginTarget: { ok: false, error: 'Only remote servers sign in.' }
    })
    await expect(service.login(LOGIN)).resolves.toEqual({
      ok: false,
      error: 'Only remote servers sign in.'
    })
    expect(deps.openLoginTerminal).not.toHaveBeenCalled()
  })

  it("refuses a project folder Megatron can't run in", async () => {
    const { deps, service } = fakes({ folder: { ok: false, error: 'Grant the folder first.' } })
    await expect(service.login(LOGIN)).resolves.toEqual({
      ok: false,
      error: 'Grant the folder first.'
    })
    expect(deps.openLoginTerminal).not.toHaveBeenCalled()
  })

  it("passes on a terminal that wouldn't open, with the command to run instead", async () => {
    const { service } = fakes({ terminal: { ok: false, error: 'Run claude mcp login yourself.' } })
    await expect(service.login(LOGIN)).resolves.toEqual({
      ok: false,
      error: 'Run claude mcp login yourself.'
    })
  })
})

describe('checkSignIn', () => {
  const LOGIN: McpLoginRef = {
    serverId: 'connector:claude_ai_Linear',
    scope: null,
    projectPath: null
  }

  it.each<McpLiveStatus>(['connected', 'degraded'])(
    'counts %s as signed in and drops the stale statuses',
    async (status) => {
      const { deps, service } = fakes({
        loginTarget: { ok: true, name: 'claude.ai Linear', projectPath: null },
        folder: { ok: true, cwd: '/app/empty' },
        status: { ok: true, status }
      })
      await expect(service.checkSignIn(LOGIN)).resolves.toEqual({
        ok: true,
        message: 'Signed in to claude.ai Linear.'
      })
      expect(deps.serverStatus).toHaveBeenCalledWith('claude.ai Linear', '/app/empty')
      expect(deps.forgetChecks).toHaveBeenCalled()
    }
  )

  it('says a server still waiting for sign-in is not signed in yet', async () => {
    const { service } = fakes({ status: { ok: true, status: 'needs_auth' } })
    await expect(service.checkSignIn(LOGIN)).resolves.toMatchObject({
      ok: true,
      verificationError: expect.stringContaining('still needs authentication')
    })
  })

  it("says so when Claude Code couldn't be asked", async () => {
    const { service } = fakes({ status: { ok: false, error: 'claude mcp get did not finish.' } })
    await expect(service.checkSignIn(LOGIN)).resolves.toMatchObject({
      ok: true,
      verificationError: expect.stringContaining('claude mcp get did not finish.')
    })
  })

  it("says so when the server can't be reached at all", async () => {
    const { service } = fakes({ status: { ok: true, status: 'failed' } })
    await expect(service.checkSignIn(LOGIN)).resolves.toMatchObject({
      ok: true,
      verificationError: expect.stringContaining("couldn't reach")
    })
  })
})
