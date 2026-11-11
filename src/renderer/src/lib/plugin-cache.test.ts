import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import { cachePluginActionResult } from './plugin-cache'
import type { PluginDetailResult, SkillRow } from '../../../shared/ipc'

const input = { name: 'demo', marketplace: 'market', scope: 'user' as const, projectPath: null }
const detail: PluginDetailResult = {
  plugin: {
    name: 'demo',
    marketplace: 'market',
    marketplace_repo: null,
    installed_version: '2.0.0',
    available_version: '2.0.0',
    disabled_reason: null,
    skill_count: 0,
    installs: []
  },
  skills: [],
  components: [],
  totalInvocations: 0,
  errorCount: 0,
  warningCount: 0
}

describe('verified plugin cache', () => {
  const skill: SkillRow = {
    id: 7,
    name: 'demo:helper',
    source_type: 'plugin',
    source_path: '/fixture/plugin/skills/helper',
    plugin_name: 'demo@market',
    description: 'Fixture helper',
    last_scanned_at: '2026-10-27',
    est_listing_tokens: 12,
    est_body_tokens: 20,
    project_root: null,
    metadata_json: null,
    modified_at: null,
    is_synced: 0,
    hook_events: null,
    disabled_reason: 'plugin',
    model_invocable: 1,
    total_invocations: 0,
    last_invoked_at: null,
    shadowed_by_skill_id: null,
    lint_status: 'clean',
    error_count: 0,
    warning_count: 0
  }

  it.each([false, true])(
    'refreshes affected skill metadata and budget data after a verified action (uninstall: %s)',
    async (uninstall) => {
      const client = new QueryClient()
      const snapshot = { ...detail, skills: [skill] }
      client.setQueryData(['plugin-detail', 'demo', 'market', 'all', null], snapshot)
      client.setQueryData(['skills'], { marker: 'cached budget' })
      client.setQueryData(['skill-meta', 7], { marker: 'affected' })
      client.setQueryData(['skill-files', 7], { marker: 'affected' })
      client.setQueryData(['skill-meta', 8], { marker: 'unrelated' })
      await cachePluginActionResult(client, input, uninstall ? null : snapshot)
      expect(client.getQueryState(['skills'])?.isInvalidated).toBe(true)
      expect(client.getQueryState(['skill-meta', 7])?.isInvalidated).toBe(true)
      expect(client.getQueryState(['skill-files', 7])?.isInvalidated).toBe(true)
      expect(client.getQueryState(['skill-meta', 8])?.isInvalidated).toBe(false)
      client.clear()
    }
  )

  it('preserves inventory order and other marketplaces after an update', async () => {
    const client = new QueryClient()
    const other = { ...detail.plugin, marketplace: 'other-market' }
    client.setQueryData(['plugins'], [{ ...detail.plugin, installed_version: '1.0.0' }, other])
    await cachePluginActionResult(client, input, detail)
    expect(client.getQueryData(['plugins'])).toEqual([detail.plugin, other])
    client.clear()
  })

  it('updates inventory and every detail context while cancelling an older pending read', async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } }
    })
    const key = ['plugin-detail', 'demo', 'market', 'all', null]
    client.setQueryData(key, {
      ...detail,
      plugin: { ...detail.plugin, installed_version: '1.0.0' }
    })
    client.setQueryData(['plugin-detail', 'demo', 'market', 'user', null], null)
    client.setQueryData(['plugins'], [{ ...detail.plugin, installed_version: '1.0.0' }])
    let finishOld!: (value: PluginDetailResult) => void
    const oldRead = client
      .fetchQuery({
        queryKey: key,
        queryFn: () => new Promise<PluginDetailResult>((resolve) => (finishOld = resolve))
      })
      .catch(() => undefined)
    await cachePluginActionResult(client, input, detail)
    finishOld({ ...detail, plugin: { ...detail.plugin, installed_version: '1.0.0' } })
    await oldRead
    expect(client.getQueryData(key)).toEqual(detail)
    expect(client.getQueryData(['plugin-detail', 'demo', 'market', 'user', null])).toEqual(detail)
    expect(client.getQueryData(['plugins'])).toEqual([detail.plugin])
    client.clear()
  })

  it('removes an uninstalled identity without affecting another marketplace', async () => {
    const client = new QueryClient()
    const other = { ...detail.plugin, marketplace: 'other-market' }
    client.setQueryData(['plugins'], [detail.plugin, other])
    await cachePluginActionResult(client, input, null)
    expect(client.getQueryData(['plugins'])).toEqual([other])
    client.clear()
  })
})
