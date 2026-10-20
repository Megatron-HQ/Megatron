import { describe, expect, it } from 'vitest'
import type { PluginDetailResult, PluginInstall } from '../../../shared/ipc'
import { performPluginAction, type PluginActionApi } from './plugin-action'

const install: PluginInstall = {
  scope: 'user',
  project_path: null,
  install_path: '/plugins/demo/1.0.0',
  installed_version: '1.0.0',
  available_version: '2.0.0',
  installed_at: null,
  last_updated: null,
  git_commit_sha: null,
  disabled_reason: null,
  enablement_known: true,
  project_missing: false
}
const input = { name: 'demo', marketplace: 'market', scope: 'user' as const, projectPath: null }
function detail(installs: PluginInstall[]): PluginDetailResult {
  return {
    plugin: {
      name: 'demo',
      marketplace: 'market',
      marketplace_repo: null,
      installed_version: installs[0]?.installed_version ?? 'unknown',
      available_version: '2.0.0',
      disabled_reason: null,
      skill_count: 0,
      installs
    },
    skills: [],
    totalInvocations: 0,
    errorCount: 0,
    warningCount: 0
  }
}
function apiWith(result: PluginDetailResult | null): PluginActionApi {
  return {
    enablePlugin: async () => ({ ok: true }),
    disablePlugin: async () => ({ ok: true }),
    updatePlugin: async () => ({ ok: true }),
    uninstallPlugin: async () => ({ ok: true }),
    getPluginDetail: async () => result
  }
}

describe('verified plugin actions', () => {
  it('does not claim an unchanged version is latest while the catalog still reports an update', async () => {
    await expect(
      performPluginAction(
        { verb: 'update', input, previousVersion: '1.0.0' },
        apiWith(detail([install]))
      )
    ).rejects.toThrow(/still.*update/i)
  })
  it('reports the installed version after a verified update', async () => {
    const result = await performPluginAction(
      { verb: 'update', input, previousVersion: '1.0.0' },
      apiWith(detail([{ ...install, installed_version: '2.0.0' }]))
    )
    expect(result.message).toBe('demo updated to 2.0.0')
  })
  it('reports no version change without claiming latest when the marketplace version is unknown', async () => {
    const snapshot = detail([{ ...install, available_version: null }])
    snapshot.plugin.available_version = null
    const result = await performPluginAction(
      { verb: 'update', input, previousVersion: '1.0.0' },
      apiWith(snapshot)
    )
    expect(result.message).toBe('demo: no version change (1.0.0)')
  })
  it('verifies enablement on the target scope rather than another install', async () => {
    const snapshot = detail([
      { ...install, disabled_reason: 'plugin' },
      { ...install, scope: 'project', project_path: '/repo' }
    ])
    await expect(
      performPluginAction({ verb: 'enable', input, previousVersion: '1.0.0' }, apiWith(snapshot))
    ).rejects.toThrow(/could not verify/i)
  })
  it('verifies a disabled install before reporting success', async () => {
    const result = await performPluginAction(
      { verb: 'disable', input, previousVersion: '1.0.0' },
      apiWith(detail([{ ...install, disabled_reason: 'plugin' }]))
    )
    expect(result.message).toBe('demo disabled')
  })
  it('does not report an uninstall until the target install disappears', async () => {
    await expect(
      performPluginAction(
        { verb: 'uninstall', input, previousVersion: '1.0.0' },
        apiWith(detail([install]))
      )
    ).rejects.toThrow(/could not verify/i)
    expect(
      (
        await performPluginAction(
          { verb: 'uninstall', input, previousVersion: '1.0.0' },
          apiWith(null)
        )
      ).message
    ).toBe('demo uninstalled')
  })
  it('preserves a CLI failure and does not treat it as a successful change', async () => {
    const api = apiWith(null)
    api.updatePlugin = async () => ({ ok: false, stderr: 'Network unavailable' })
    await expect(
      performPluginAction({ verb: 'update', input, previousVersion: '1.0.0' }, api)
    ).rejects.toThrow('Network unavailable')
  })
  it('shows the actionable IPC error without Electron internals', async () => {
    const api = apiWith(null)
    api.updatePlugin = async () => {
      throw new Error("Error invoking remote method 'plugins:update': Error: Network unavailable")
    }
    await expect(
      performPluginAction({ verb: 'update', input, previousVersion: '1.0.0' }, api)
    ).rejects.toEqual(new Error('Network unavailable'))
  })
  it('recovers with a useful message when an action rejects without an Error object', async () => {
    const api = apiWith(null)
    api.updatePlugin = async () => {
      throw null
    }
    await expect(
      performPluginAction({ verb: 'update', input, previousVersion: '1.0.0' }, api)
    ).rejects.toEqual(new Error('Action failed unexpectedly. Try again.'))
  })
  it('explains that the command completed when verification fails', async () => {
    const api = apiWith(null)
    api.getPluginDetail = async () => {
      throw new Error('Index unavailable')
    }
    await expect(
      performPluginAction({ verb: 'disable', input, previousVersion: '1.0.0' }, api)
    ).rejects.toThrow(/command completed.*could not verify/i)
  })
})
