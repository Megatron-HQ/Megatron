import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'
import type { ScanSummary } from '../../../shared/ipc'
import { refreshScanQueries } from './refresh-scan-queries'

function populatedClient(): QueryClient {
  const client = new QueryClient()
  for (const key of [
    'skills',
    'projects',
    'plugins',
    'skill-files',
    'usage',
    'skill-history',
    'usage-skill-invocations'
  ]) {
    client.setQueryData([key], { available: true })
  }
  return client
}

describe('scan query refresh scope', () => {
  it('refreshes live inventory without invalidating an open Usage or historical activity query', async () => {
    const client = populatedClient()
    const summary: ScanSummary = {
      outcome: 'complete',
      completedAt: '2026-11-05T00:00:00.000Z',
      sources: ['scanSkills', 'scanPluginRegistry', 'runLinter'].map((name) => ({
        name,
        status: 'complete'
      }))
    }

    await refreshScanQueries(client, false, summary)

    expect(client.getQueryState(['skills'])?.isInvalidated).toBe(true)
    expect(client.getQueryState(['projects'])?.isInvalidated).toBe(true)
    expect(client.getQueryState(['plugins'])?.isInvalidated).toBe(true)
    expect(client.getQueryState(['skill-files'])?.isInvalidated).toBe(true)
    expect(client.getQueryState(['usage'])?.isInvalidated).toBe(false)
    expect(client.getQueryState(['skill-history'])?.isInvalidated).toBe(false)
    expect(client.getQueryState(['usage-skill-invocations'])?.isInvalidated).toBe(false)
    client.clear()
  })

  it('continues refreshing Usage after a full scan or an explicit manual refresh', async () => {
    for (const summary of [
      undefined,
      {
        outcome: 'complete' as const,
        completedAt: '2026-11-05T00:00:00.000Z',
        sources: [{ name: 'scanTranscripts', status: 'complete' as const }]
      }
    ]) {
      const client = populatedClient()
      await refreshScanQueries(client, false, summary)
      expect(client.getQueryState(['usage'])?.isInvalidated).toBe(true)
      expect(client.getQueryState(['skill-history'])?.isInvalidated).toBe(true)
      client.clear()
    }
  })
})
