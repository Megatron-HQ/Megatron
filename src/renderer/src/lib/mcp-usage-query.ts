import { queryOptions } from '@tanstack/react-query'

// Under ['usage'] so a full scan and a Usage project link refresh it with the rest of Usage.
export const MCP_USAGE_QUERY_KEY = ['usage', 'mcp'] as const

export const mcpUsageQuery = queryOptions({
  queryKey: MCP_USAGE_QUERY_KEY,
  queryFn: () => window.api.getUsageMcp()
})
