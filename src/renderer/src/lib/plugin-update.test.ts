import { describe, expect, it } from 'vitest'
import type { PluginInstall, PluginRow } from '../../../shared/ipc'
import { pluginUpdateDetails } from './plugin-update'

function makeInstall(overrides: Partial<PluginInstall> = {}): PluginInstall {
  return {
    scope: 'user',
    install_path: '/path/to/install',
    installed_at: null,
    last_updated: null,
    git_commit_sha: null,
    project_path: null,
    installed_version: '1.0.0',
    available_version: '1.0.0',
    disabled_reason: null,
    enablement_known: true,
    ...overrides
  }
}

function makePlugin(overrides: Partial<PluginRow> = {}): PluginRow {
  return {
    name: 'test-plugin',
    marketplace: 'market',
    marketplace_repo: null,
    installed_version: '1.0.0',
    available_version: '1.0.0',
    disabled_reason: null,
    skill_count: 1,
    installs: [makeInstall()],
    ...overrides
  }
}

describe('pluginUpdateDetails', () => {
  it('returns hasUpdate: false when installed version matches available version', () => {
    const plugin = makePlugin({
      installed_version: '1.0.0',
      available_version: '1.0.0',
      installs: [makeInstall({ installed_version: '1.0.0', available_version: '1.0.0' })]
    })
    const details = pluginUpdateDetails(plugin)
    expect(details.hasUpdate).toBe(false)
    expect(details.message).toBe('')
    expect(details.availableVersion).toBeNull()
  })

  it('returns hasUpdate: true with single user-scope update message', () => {
    const plugin = makePlugin({
      installed_version: '1.0.0',
      available_version: '1.2.0',
      installs: [
        makeInstall({ scope: 'user', installed_version: '1.0.0', available_version: '1.2.0' })
      ]
    })
    const details = pluginUpdateDetails(plugin)
    expect(details.hasUpdate).toBe(true)
    expect(details.availableVersion).toBe('1.2.0')
    expect(details.message).toBe('Update available for User scope: v1.0.0 → v1.2.0')
  })

  it('does not duplicate an existing version prefix in its update message', () => {
    const plugin = makePlugin({
      installed_version: 'v1.0.0',
      available_version: 'v1.2.0',
      installs: [
        makeInstall({ scope: 'user', installed_version: 'v1.0.0', available_version: 'v1.2.0' })
      ]
    })

    expect(pluginUpdateDetails(plugin).message).not.toContain('vv')
  })

  it('returns hasUpdate: true with project-scope path in message', () => {
    const plugin = makePlugin({
      installed_version: '1.0.0',
      available_version: '2.0.0',
      installs: [
        makeInstall({
          scope: 'project',
          project_path: '/repos/megatron',
          installed_version: '1.0.0',
          available_version: '2.0.0'
        })
      ]
    })
    const details = pluginUpdateDetails(plugin)
    expect(details.hasUpdate).toBe(true)
    expect(details.availableVersion).toBe('2.0.0')
    expect(details.message).toBe('Update available for Project (/repos/megatron): v1.0.0 → v2.0.0')
  })

  it('handles multiple installs where some are behind', () => {
    const plugin = makePlugin({
      installed_version: '1.0.0',
      available_version: '1.2.0',
      installs: [
        makeInstall({ scope: 'user', installed_version: '1.0.0', available_version: '1.2.0' }),
        makeInstall({
          scope: 'project',
          project_path: '/repo',
          installed_version: '1.0.0',
          available_version: '1.2.0'
        })
      ]
    })
    const details = pluginUpdateDetails(plugin)
    expect(details.hasUpdate).toBe(true)
    expect(details.availableVersion).toBe('1.2.0')
    expect(details.message).toBe('Update available (user, project): → v1.2.0')
  })
})
