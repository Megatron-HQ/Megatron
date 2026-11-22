import Database from 'better-sqlite3'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applySchema } from './schema'
import { openUsageArchive } from './usage-archive'
import {
  attachUsageArchive,
  hasUsageArchive,
  knownMcpCallsSql,
  knownSkillInvocationsSql,
  usageHistorySince
} from './known-calls'

let directory: string
let archivePath: string
let index: Database.Database
let archive: Database.Database

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'megatron-known-calls-'))
  archivePath = join(directory, 'usage-history.db')
  index = new Database(':memory:')
  applySchema(index)
  archive = openUsageArchive(archivePath)
  index
    .prepare(
      `INSERT INTO sessions_meta (session_id, cwd, git_branch, started_at, message_count,
         source_mtime_ms)
       VALUES ('live', '/repo', 'main', '2026-11-10T00:00:00.000Z', 1, ?)`
    )
    .run(Date.parse('2026-11-10T08:00:00.000Z'))
})

afterEach(() => {
  index.close()
  archive.close()
  rmSync(directory, { recursive: true, force: true })
})

function indexInvocation(uuid: string, trigger = 'user_invoked'): void {
  index
    .prepare(
      `INSERT INTO skill_invocations (source_uuid, session_id, skill_name, args_text, invoked_at,
         trigger_type, agent_id, preceding_user_text)
       VALUES (?, 'live', 'deploy', 'prod', '2026-11-10T09:00:00.000Z', ?, NULL, 'ship it')`
    )
    .run(uuid, trigger)
}

function archivedInvocation(uuid: string, trigger = 'user_invoked'): void {
  archive
    .prepare(
      `INSERT INTO history_skill_invocations (source_uuid, session_id, project, skill_name,
         invoked_at, trigger_type, agent_id)
       VALUES (?, 'pruned', '/old-repo', 'deploy', '2026-09-01T09:00:00.000Z', ?, NULL)`
    )
    .run(uuid, trigger)
}

function indexCall(id: string, isError: number | null = 0): void {
  index
    .prepare(
      `INSERT INTO mcp_tool_calls (tool_use_id, session_id, cwd, qualified_name, invoked_at,
         is_error, is_denied, result_chars, result_images)
       VALUES (?, 'live', '/repo', 'github__search', '2026-11-10T09:00:00.000Z', ?, 0, 10, 0)`
    )
    .run(id, isError)
}

function archivedCall(id: string): void {
  archive
    .prepare(
      `INSERT INTO history_mcp_calls (tool_use_id, session_id, cwd, project, qualified_name,
         invoked_at, is_error, is_denied, result_chars, result_images)
       VALUES (?, 'pruned', NULL, '/old-repo', 'github__search', '2026-09-01T09:00:00.000Z',
         NULL, NULL, NULL, NULL)`
    )
    .run(id)
}

const invocations = (): Array<Record<string, unknown>> =>
  index
    .prepare(`SELECT * FROM ${knownSkillInvocationsSql(index)} si ORDER BY source_uuid`)
    .all() as Array<Record<string, unknown>>
const calls = (): Array<Record<string, unknown>> =>
  index.prepare(`SELECT * FROM ${knownMcpCallsSql(index)} c ORDER BY tool_use_id`).all() as Array<
    Record<string, unknown>
  >

describe('without an attached archive', () => {
  it('reads invocations from the index alone, none of them pruned', () => {
    indexInvocation('u1')
    expect(hasUsageArchive(index)).toBe(false)
    expect(invocations()).toEqual([
      {
        source_uuid: 'u1',
        session_id: 'live',
        skill_name: 'deploy',
        invoked_at: '2026-11-10T09:00:00.000Z',
        trigger_type: 'user_invoked',
        agent_id: null,
        cwd: '/repo',
        index_id: expect.any(Number),
        args_text: 'prod',
        preceding_user_text: 'ship it',
        git_branch: 'main',
        transcript_pruned: 0
      }
    ])
  })

  it('reads MCP calls from the index alone', () => {
    indexCall('t1')
    expect(calls()).toMatchObject([{ tool_use_id: 't1', is_error: 0, result_chars: 10 }])
  })

  it("files a call under its own folder, else its session's", () => {
    indexCall('t1')
    index.prepare('UPDATE mcp_tool_calls SET cwd = NULL').run()
    expect(calls()).toMatchObject([{ tool_use_id: 't1', cwd: null, project: '/repo' }])
  })

  it('dates the history from the oldest retained transcript', () => {
    expect(usageHistorySince(index)).toBe('2026-11-10T08:00:00.000Z')
  })

  it('has no history date with no transcript at all', () => {
    index.prepare('DELETE FROM sessions_meta').run()
    expect(usageHistorySince(index)).toBeNull()
  })
})

describe('with the archive attached', () => {
  beforeEach(() => attachUsageArchive(index, archivePath))

  it('adds invocations whose transcript is pruned, marked as such, without their content', () => {
    archivedInvocation('old')
    indexInvocation('u1')
    expect(invocations()).toMatchObject([
      {
        source_uuid: 'old',
        cwd: '/old-repo',
        index_id: null,
        args_text: null,
        preceding_user_text: null,
        git_branch: null,
        transcript_pruned: 1
      },
      { source_uuid: 'u1', cwd: '/repo', preceding_user_text: 'ship it', transcript_pruned: 0 }
    ])
  })

  it("counts a row both hold once, with the index's current reading", () => {
    indexInvocation('u1', 'autonomous')
    archive
      .prepare(
        `INSERT INTO history_skill_invocations (source_uuid, session_id, project, skill_name,
           invoked_at, trigger_type, agent_id)
         VALUES ('u1', 'live', '/repo', 'deploy', '2026-11-10T09:00:00.000Z', 'user_invoked', NULL)`
      )
      .run()
    expect(invocations()).toMatchObject([
      { source_uuid: 'u1', trigger_type: 'autonomous', git_branch: 'main', transcript_pruned: 0 }
    ])
  })

  it('adds pruned MCP calls and prefers the index result for a call both hold', () => {
    archivedCall('old')
    archivedCall('t1')
    indexCall('t1', 1)
    expect(calls()).toMatchObject([
      { tool_use_id: 'old', is_error: null, cwd: null, project: '/old-repo' },
      { tool_use_id: 't1', is_error: 1, cwd: '/repo', project: '/repo', result_chars: 10 }
    ])
  })

  it('dates the history from the start of the latest unbroken coverage', () => {
    const insert = archive.prepare('INSERT INTO history_transcript_coverage VALUES (?, ?)')
    insert.run('2026-08-01T00:00:00.000Z', '2026-08-20T00:00:00.000Z')
    insert.run('2026-10-01T00:00:00.000Z', '2026-11-12T00:00:00.000Z')
    expect(usageHistorySince(index)).toBe('2026-10-01T00:00:00.000Z')
  })

  it('falls back to the oldest retained transcript before any coverage is recorded', () => {
    expect(usageHistorySince(index)).toBe('2026-11-10T08:00:00.000Z')
  })

  it('attaches once however often it is asked', () => {
    attachUsageArchive(index, archivePath)
    expect(
      index
        .prepare("SELECT COUNT(*) FROM pragma_database_list WHERE name = 'usage_archive'")
        .pluck()
        .get()
    ).toBe(1)
  })
})

describe('attaching something that is not an archive', () => {
  it('stays on the index alone and says why', () => {
    const notAnArchive = join(directory, 'other.db')
    new Database(notAnArchive).close()
    expect(() => attachUsageArchive(index, notAnArchive)).toThrow(/not a usage archive/)
    expect(hasUsageArchive(index)).toBe(false)
  })

  it('refuses a file that is not a database at all', () => {
    const garbage = join(directory, 'garbage.db')
    writeFileSync(garbage, 'not sqlite at all, just text that is long enough to have a header')
    expect(() => attachUsageArchive(index, garbage)).toThrow()
    expect(hasUsageArchive(index)).toBe(false)
  })
})
