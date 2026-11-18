import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { usageProjectCatalog, readClaudeAppChats } from './usage-projects'
import { applySchema } from './db/schema'
import { openUsageArchive } from './db/usage-archive'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

describe('Claude app chats', () => {
  const chats = '/Users/sai/Library/Application Support/Claude/scratch-workspaces/a/b'
  const renamed = `${chats}/scratch-2026-11-06-0f5802`
  const pruned = `${chats}/scratch-2026-10-07-4f09d6`

  it('reads each chat title from its newest titled transcript and its earliest known start', () => {
    const directory = mkdtempSync(join(tmpdir(), 'megatron-chats-'))
    const index = new Database(':memory:')
    applySchema(index)
    const archive = openUsageArchive(join(directory, 'usage-history.db'))
    try {
      const session = index.prepare(
        `INSERT INTO sessions_meta (session_id, cwd, started_at, message_count, source_mtime_ms, title)
         VALUES (?, ?, ?, 1, ?, ?)`
      )
      session.run('older', renamed, '2026-11-06T10:00:00.000Z', 1, 'First name')
      session.run('newer', renamed, '2026-11-06T12:00:00.000Z', 2, 'Renamed')
      session.run('newest', renamed, '2026-11-06T13:00:00.000Z', 3, null)
      session.run('repo', '/Users/sai/code/repo', '2026-11-01T00:00:00.000Z', 4, 'Repo work')
      const archived = archive.prepare('INSERT INTO history_sessions VALUES (?, ?, ?, NULL, 1, 0)')
      archived.run('gone', renamed, '2026-11-05T23:00:00.000Z')
      archived.run('pruned', pruned, '2026-10-07T09:00:00.000Z')

      expect(Object.fromEntries(readClaudeAppChats(index, archive))).toEqual({
        [renamed]: {
          title: 'Renamed',
          startedAt: '2026-11-05T23:00:00.000Z'
        },
        [pruned]: { title: null, startedAt: '2026-10-07T09:00:00.000Z' }
      })
    } finally {
      index.close()
      archive.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('marks chat projects at read time without touching the persisted locations', () => {
    const locations = [renamed, pruned, '/Users/sai/code/repo'].map((path, index) => ({
      id: String(index),
      path,
      kind: 'folder' as const,
      status: 'needs_access' as const
    }))
    const saved = JSON.stringify(locations)

    const catalog = usageProjectCatalog(
      { locations, claudeCodeFolders: [] },
      new Map([[renamed, { title: 'Renamed', startedAt: '2026-11-06T10:00:00.000Z' }]])
    )

    expect(catalog.projects.find((project) => project.path === renamed)?.chat).toEqual({
      title: 'Renamed',
      startedAt: '2026-11-06T10:00:00.000Z'
    })
    expect(catalog.projects.find((project) => project.path === pruned)?.chat).toEqual({
      title: null,
      startedAt: null
    })
    expect(
      catalog.projects.find((project) => project.path === '/Users/sai/code/repo')
    ).not.toHaveProperty('chat')
    expect(JSON.stringify(catalog.locations)).toBe(saved)
  })
})
