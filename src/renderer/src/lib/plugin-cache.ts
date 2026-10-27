import type { QueryClient } from '@tanstack/react-query'
import type { PluginActionInput, PluginDetailResult, PluginRow } from '../../../shared/ipc'

export async function cachePluginActionResult(
  queryClient: QueryClient,
  input: PluginActionInput,
  detail: PluginDetailResult | null
): Promise<void> {
  const detailKey = ['plugin-detail', input.name, input.marketplace]
  const previous = queryClient.getQueriesData<PluginDetailResult | null>({ queryKey: detailKey })
  const skillIds = new Set([
    ...previous.flatMap(([, snapshot]) => snapshot?.skills.map((skill) => skill.id) ?? []),
    ...(detail?.skills.map((skill) => skill.id) ?? [])
  ])
  const affectedSkillKeys = [...skillIds].flatMap((id) => [
    ['skill-meta', id],
    ['skill-files', id]
  ])
  // Cancel reads started before the command so their old snapshots cannot replace this result.
  await Promise.all([
    queryClient.cancelQueries({ queryKey: detailKey }),
    queryClient.cancelQueries({ queryKey: ['plugins'] }),
    queryClient.cancelQueries({ queryKey: ['skills'] }),
    ...affectedSkillKeys.map((queryKey) => queryClient.cancelQueries({ queryKey }))
  ])
  queryClient.setQueriesData({ queryKey: detailKey }, detail)
  queryClient.setQueryData<PluginRow[]>(['plugins'], (plugins) => {
    if (!plugins) return plugins
    const matchesPlugin = (plugin: PluginRow): boolean =>
      plugin.name === input.name && plugin.marketplace === input.marketplace
    if (!detail) return plugins.filter((plugin) => !matchesPlugin(plugin))
    if (!plugins.some(matchesPlugin)) return [...plugins, detail.plugin]
    return plugins.map((plugin) => (matchesPlugin(plugin) ? detail.plugin : plugin))
  })
  // Skill state and the context budget come from the refreshed index; their reads need not hold the action open.
  void queryClient.invalidateQueries({ queryKey: ['skills'] })
  for (const queryKey of affectedSkillKeys) void queryClient.invalidateQueries({ queryKey })
}
