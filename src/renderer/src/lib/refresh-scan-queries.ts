import type { QueryClient } from '@tanstack/react-query'
import type { ScanSummary } from '../../../shared/ipc'
import { MCP_USAGE_QUERY_KEY } from './mcp-usage-query'

const SCAN_QUERY_KEYS = [
  'skills',
  'folders',
  'projects',
  'skill-meta',
  'skill-files',
  'plugins',
  'plugin-detail',
  // MCP rows hold call counts too, so they refresh after every scan, not only full ones.
  'mcp-servers',
  'mcp-detail'
]
const USAGE_QUERY_KEYS = ['usage', 'skill-history', 'usage-skill-invocations']
const INVENTORY_SOURCE_NAMES = new Set([
  'scanSkills',
  'scanPluginRegistry',
  'scanMcpDeclarations',
  'runLinter'
])

export async function refreshScanQueries(
  client: QueryClient,
  throwOnError = false,
  summary?: ScanSummary
): Promise<void> {
  const inventoryOnly =
    summary !== undefined &&
    summary.sources.length > 0 &&
    summary.sources.every((source) => INVENTORY_SOURCE_NAMES.has(source.name))
  const queryKeys: ReadonlyArray<readonly string[]> = [
    ...(inventoryOnly ? SCAN_QUERY_KEYS : [...SCAN_QUERY_KEYS, ...USAGE_QUERY_KEYS]).map((key) => [
      key
    ]),
    // Credits calls by the Declarations an inventory scan rereads (docs/mcp-servers.md).
    ...(inventoryOnly ? [MCP_USAGE_QUERY_KEY] : [])
  ]
  await Promise.all(
    queryKeys.map((queryKey) => client.invalidateQueries({ queryKey }, { throwOnError }))
  )
}
