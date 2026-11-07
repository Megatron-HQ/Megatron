import type { QueryClient } from '@tanstack/react-query'
import type { ScanSummary } from '../../../shared/ipc'

const SCAN_QUERY_KEYS = [
  'skills',
  'folders',
  'projects',
  'skill-meta',
  'skill-files',
  'plugins',
  'plugin-detail'
]
const USAGE_QUERY_KEYS = ['usage', 'skill-history', 'usage-skill-invocations']
const INVENTORY_SOURCE_NAMES = new Set(['scanSkills', 'scanPluginRegistry', 'runLinter'])

export async function refreshScanQueries(
  client: QueryClient,
  throwOnError = false,
  summary?: ScanSummary
): Promise<void> {
  const inventoryOnly =
    summary !== undefined &&
    summary.sources.length > 0 &&
    summary.sources.every((source) => INVENTORY_SOURCE_NAMES.has(source.name))
  const queryKeys = inventoryOnly ? SCAN_QUERY_KEYS : [...SCAN_QUERY_KEYS, ...USAGE_QUERY_KEYS]
  await Promise.all(
    queryKeys.map((key) => client.invalidateQueries({ queryKey: [key] }, { throwOnError }))
  )
}
