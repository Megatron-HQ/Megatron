import { describe, expect, it } from 'vitest'
import type { McpDeclarationDetail } from '../../../shared/ipc'
import {
  connectorOffersLogin,
  mcpLoginRef,
  McpActionError,
  mcpActionMessage,
  mcpDeclarationActions,
  mcpDeclarationRef
} from './mcp-action'

function declaration(overrides: Partial<McpDeclarationDetail>): McpDeclarationDetail {
  return {
    scope: 'user',
    projectPath: null,
    plugin: null,
    transport: 'stdio',
    problem: null,
    location: 'npx',
    env: [],
    headers: [],
    argCount: 1,
    hasLiteralCredential: false,
    approval: null,
    sourcePath: '/home/.claude.json',
    shadowedIn: [],
    commandIsBare: false,
    ...overrides
  }
}

describe('mcpDeclarationActions', () => {
  it('offers remove on every configured declaration and logout only on remote ones', () => {
    expect(mcpDeclarationActions(declaration({ transport: 'stdio' }))).toEqual({
      remove: true,
      logout: false,
      login: false,
      reset: false
    })
    for (const transport of ['http', 'sse', 'ws'] as const)
      expect(mcpDeclarationActions(declaration({ transport }))).toMatchObject({
        logout: true,
        login: true
      })
  })

  it('offers a reset only on a project declaration', () => {
    expect(
      mcpDeclarationActions(
        declaration({
          scope: 'project',
          projectPath: '/repo',
          transport: 'http',
          approval: 'pending'
        })
      )
    ).toEqual({ remove: true, logout: true, login: true, reset: true })
    expect(mcpDeclarationActions(declaration({ scope: 'local', projectPath: '/repo' })).reset).toBe(
      false
    )
  })

  // A skipped declaration (url without type) still loads nowhere, but it can still be removed.
  it('offers no logout or login on a declaration Claude Code skips', () => {
    expect(
      mcpDeclarationActions(declaration({ transport: null, problem: 'url_without_type' }))
    ).toEqual({ remove: true, logout: false, login: false, reset: false })
  })

  it('offers nothing on a plugin declaration', () => {
    expect(
      mcpDeclarationActions(
        declaration({ scope: 'plugin', plugin: { name: 'p', marketplace: 'm' }, transport: 'http' })
      )
    ).toEqual({ remove: false, logout: false, login: false, reset: false })
  })
})

describe('mcpDeclarationRef', () => {
  it('names a configured declaration by server id, scope, and project', () => {
    expect(
      mcpDeclarationRef('configured:api', declaration({ scope: 'local', projectPath: '/repo' }))
    ).toEqual({ serverId: 'configured:api', scope: 'local', projectPath: '/repo' })
  })

  it('names none for a plugin declaration', () => {
    expect(
      mcpDeclarationRef(
        'plugin:p:s',
        declaration({ scope: 'plugin', plugin: { name: 'p', marketplace: 'm' } })
      )
    ).toBeNull()
  })
})

describe('mcpActionMessage', () => {
  it("returns a confirmed action's message", () => {
    expect(mcpActionMessage({ ok: true, message: 'Removed api from user scope.' })).toBe(
      'Removed api from user scope.'
    )
  })

  it('throws a failure and an unconfirmed result apart', () => {
    const thrown = (result: Parameters<typeof mcpActionMessage>[0]): McpActionError => {
      try {
        mcpActionMessage(result)
      } catch (error) {
        if (error instanceof McpActionError) return error
      }
      throw new Error('expected an McpActionError')
    }

    expect(thrown({ ok: false, error: 'Grant this folder first.' })).toMatchObject({
      message: 'Grant this folder first.',
      unconfirmed: false
    })
    expect(thrown({ ok: true, verificationError: "couldn't reach api" })).toMatchObject({
      message: "couldn't reach api",
      unconfirmed: true
    })
  })
})

describe('mcpLoginRef', () => {
  it('names a configured Declaration by its scope and project, and a connector by its id alone', () => {
    expect(
      mcpLoginRef('configured:api', declaration({ scope: 'local', projectPath: '/repo' }))
    ).toEqual({
      serverId: 'configured:api',
      scope: 'local',
      projectPath: '/repo'
    })
    expect(mcpLoginRef('connector:claude_ai_Linear', null)).toEqual({
      serverId: 'connector:claude_ai_Linear',
      scope: null,
      projectPath: null
    })
  })

  it('has no ref for a plugin Declaration, which its plugin manages', () => {
    expect(mcpLoginRef('plugin:p:s', declaration({ scope: 'plugin' }))).toBeNull()
  })
})

describe('connectorOffersLogin', () => {
  it('offers sign-in unless the last check found the connector connected', () => {
    expect(connectorOffersLogin(null)).toBe(true)
    expect(
      connectorOffersLogin({ status: 'needs_auth', checkedAt: '2026-11-22T00:00:00.000Z' })
    ).toBe(true)
    expect(connectorOffersLogin({ status: 'failed', checkedAt: '2026-11-22T00:00:00.000Z' })).toBe(
      true
    )
    expect(
      connectorOffersLogin({ status: 'connected', checkedAt: '2026-11-22T00:00:00.000Z' })
    ).toBe(false)
    expect(
      connectorOffersLogin({ status: 'degraded', checkedAt: '2026-11-22T00:00:00.000Z' })
    ).toBe(false)
  })
})
