import { describe, expect, it, vi, type Mocked } from 'vitest'
import type { McpDeclarationRef, McpLiveStatus, ScanSummary } from '../shared/ipc'
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
    reportError: vi.fn()
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
