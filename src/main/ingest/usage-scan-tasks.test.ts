import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applySchema } from '../db/schema'
import { openUsageArchive } from '../db/usage-archive'
import { runAllScans } from './scan-all'
import { createUsageScanTasks } from './usage-scan-tasks'

let index: Database.Database
let archive: Database.Database
beforeEach(() => {
  index = new Database(':memory:')
  applySchema(index)
  archive = openUsageArchive(':memory:')
  index
    .prepare(
      `INSERT INTO prompt_history (session_id, project, typed_at, is_slash_command)
    VALUES ('session', '/repo', '2026-11-03T12:00:00.000Z', 0)`
    )
    .run()
})
afterEach(() => {
  index.close()
  archive.close()
})

describe('usage scan stages', () => {
  it('archives prompts even when token archival fails after transcript ingestion', () => {
    let opens = 0
    const sources = createUsageScanTasks({
      scanTranscripts: () => ({ status: 'complete' }),
      scanPromptHistory: () => ({ status: 'complete' }),
      getArchive: () => {
        if (opens++ === 0) throw new Error('Archive temporarily unavailable')
        return archive
      }
    })
    const result = runAllScans(index, sources)
    expect(result).toMatchObject({
      outcome: 'partial',
      sources: [
        { name: 'scanTranscripts', status: 'complete' },
        { name: 'archiveTokens', status: 'failed' },
        { name: 'scanPromptHistory', status: 'complete' },
        { name: 'archivePrompts', status: 'complete' }
      ]
    })
    expect(archive.prepare('SELECT COUNT(*) AS count FROM history_prompts').get()).toEqual({
      count: 1
    })
  })

  it('does not copy an incomplete source or claim coverage for it', () => {
    const sources = createUsageScanTasks({
      scanTranscripts: () => ({ status: 'partial' }),
      scanPromptHistory: () => ({ status: 'partial' }),
      getArchive: () => archive
    })
    expect(runAllScans(index, sources)).toMatchObject({ outcome: 'partial' })
    expect(archive.prepare('SELECT COUNT(*) AS count FROM history_prompts').get()).toEqual({
      count: 0
    })
    expect(archive.prepare('SELECT COUNT(*) AS count FROM history_coverage').get()).toEqual({
      count: 0
    })
  })
})
