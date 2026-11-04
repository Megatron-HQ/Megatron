import type { QueryClient } from '@tanstack/react-query'

const SCAN_QUERY_KEYS = [
  'skills',
  'folders',
  'projects',
  'skill-meta',
  'skill-files',
  'plugins',
  'plugin-detail',
  'usage',
  'skill-history',
  'usage-skill-invocations'
]

export async function refreshScanQueries(client: QueryClient, throwOnError = false): Promise<void> {
  await Promise.all(
    SCAN_QUERY_KEYS.map((key) => client.invalidateQueries({ queryKey: [key] }, { throwOnError }))
  )
}
