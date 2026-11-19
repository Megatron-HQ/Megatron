import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applySchema } from './schema'
import { getMcpUsageStats } from './mcp-usage'
import { readProjectIdentity } from '../../shared/project-identity'

const NOW = new Date('2026-11-19T12:00:00.000Z')
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
const ago = (ms: number): string => new Date(NOW.getTime() - ms).toISOString()

const noLinks = readProjectIdentity({ locations: [], claudeCodeFolders: [] })

let db: Database.Database

beforeEach(() => {
  db = new Database(':memory:')
  applySchema(db)
  for (const [session, cwd] of [
    ['s1', '/repo'],
    ['s2', '/other']
  ])
    db.prepare(
      `INSERT INTO sessions_meta (session_id, cwd, started_at, message_count, source_mtime_ms)
       VALUES (?, ?, '2026-10-01T00:00:00.000Z', 1, 0)`
    ).run(session, cwd)
  db.prepare(
    `INSERT INTO mcp_declarations (scope, project_path, name, transport, problem, location,
       env_keys, header_keys, arg_count, has_literal_credential, approval, source_path)
     VALUES ('user', '', 'github', 'stdio', NULL, 'npx', '[]', '[]', 0, 0, NULL, '/h/.claude.json')`
  ).run()
})

afterEach(() => db.close())

let callNumber = 0
function call(
  qualified: string,
  options: {
    at?: string
    session?: string
    cwd?: string | null
    error?: boolean
    denied?: boolean
    noResult?: boolean
    chars?: number
  } = {}
): void {
  callNumber += 1
  const noResult = options.noResult === true
  db.prepare(
    `INSERT INTO mcp_tool_calls (tool_use_id, session_id, cwd, qualified_name, invoked_at,
       agent_id, is_error, is_denied, result_chars, result_images)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)`
  ).run(
    `toolu_${callNumber}`,
    options.session ?? 's1',
    options.cwd === undefined ? '/repo' : options.cwd,
    qualified,
    options.at ?? ago(HOUR_MS),
    noResult ? null : options.error || options.denied ? 1 : 0,
    noResult ? null : options.denied ? 1 : 0,
    noResult ? null : (options.chars ?? 0),
    noResult ? null : 0
  )
}

describe('getMcpUsageStats', () => {
  it('counts each call in every rolling window that contains it', () => {
    call('github__search', { at: ago(HOUR_MS) })
    call('github__search', { at: ago(3 * DAY_MS) })
    call('github__search', { at: ago(20 * DAY_MS) })
    call('github__search', { at: ago(40 * DAY_MS) })

    const stats = getMcpUsageStats(db, noLinks, NOW)

    expect([stats.last24h.calls, stats.last7d.calls, stats.last30d.calls]).toEqual([1, 2, 3])
    expect(stats.last7d.startAt).toBe('2026-11-12T12:00:00.000Z')
  })

  it('names the oldest recorded call, even one before every window', () => {
    call('github__search', { at: ago(40 * DAY_MS) })
    call('github__search', { at: ago(HOUR_MS) })

    expect(getMcpUsageStats(db, noLinks, NOW).firstCallAt).toBe(ago(40 * DAY_MS))
  })

  it('ranks servers by calls with their errors, refusals, and result weight', () => {
    call('github__search', { chars: 300 })
    call('github__search', { error: true, chars: 30 })
    call('github__search', { denied: true })
    call('github__get_file', { chars: 3000 })
    call('claude-in-chrome__navigate', { chars: 0 })

    expect(getMcpUsageStats(db, noLinks, NOW).last24h.byServer).toEqual([
      {
        id: 'configured:github',
        name: 'github',
        kind: 'configured',
        calls: 4,
        errors: 1,
        denied: 1,
        errorRate: 1 / 3,
        resultTokens: 1110
      },
      {
        id: 'observed:claude-in-chrome',
        name: 'claude-in-chrome',
        kind: 'observed',
        calls: 1,
        errors: 0,
        denied: 0,
        errorRate: 0,
        resultTokens: 0
      }
    ])
  })

  it('leaves the error rate unknown when every call was refused', () => {
    call('github__search', { denied: true })
    call('github__search', { denied: true })

    expect(getMcpUsageStats(db, noLinks, NOW).last24h.byServer[0].errorRate).toBeNull()
  })

  it('counts a call with no recorded result without calling it an error', () => {
    call('github__search', { noResult: true })

    expect(getMcpUsageStats(db, noLinks, NOW).last24h.byServer[0]).toMatchObject({
      calls: 1,
      errors: 0,
      errorRate: 0,
      resultTokens: 0
    })
  })

  it('sums the window totals across servers', () => {
    call('github__search', { error: true, chars: 9, session: 's1' })
    call('github__search', { denied: true, session: 's2' })
    call('claude-in-chrome__navigate', { chars: 6, session: 's2' })

    expect(getMcpUsageStats(db, noLinks, NOW).last24h).toMatchObject({
      calls: 3,
      errors: 1,
      denied: 1,
      resultTokens: 5,
      serverCount: 2,
      sessionCount: 2,
      ambiguousCalls: 0
    })
  })

  it('counts calls on a shared prefix in the totals but credits no server', () => {
    for (const name of ['git.hub', 'git_hub'])
      db.prepare(
        `INSERT INTO mcp_declarations (scope, project_path, name, transport, problem, location,
           env_keys, header_keys, arg_count, has_literal_credential, approval, source_path)
         VALUES ('user', '', ?, 'stdio', NULL, 'npx', '[]', '[]', 0, 0, NULL, '/h/.claude.json')`
      ).run(name)
    call('git_hub__search')

    expect(getMcpUsageStats(db, noLinks, NOW).last24h).toMatchObject({
      calls: 1,
      ambiguousCalls: 1,
      serverCount: 0,
      byServer: []
    })
  })

  it("groups calls by Usage project, falling back to the session's folder", () => {
    const identity = readProjectIdentity({
      locations: [
        { id: 'repo', path: '/repo', kind: 'repository', status: 'available' },
        { id: 'old', path: '/old', kind: 'repository', status: 'missing', linkedTo: 'repo' }
      ],
      claudeCodeFolders: []
    })
    call('github__search', { cwd: '/repo/packages/web' })
    call('github__search', { cwd: '/old' })
    call('github__search', { cwd: null, session: 's2' })

    expect(getMcpUsageStats(db, identity, NOW).last24h.byProject).toEqual([
      { project: '/repo', count: 2 },
      { project: '/other', count: 1 }
    ])
  })

  it('buckets the trend by local day across the window', () => {
    const at = ago(2 * DAY_MS)
    call('github__search', { at })
    call('github__search', { at })
    call('github__search', { at: ago(HOUR_MS) })

    const { trend } = getMcpUsageStats(db, noLinks, NOW).last7d
    const day = new Date(at).toLocaleDateString('en-CA')

    expect(trend.find((bucket) => bucket.key === day)?.count).toBe(2)
    expect(trend.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(3)
  })

  it('reports empty windows when nothing was called', () => {
    const stats = getMcpUsageStats(db, noLinks, NOW)

    expect(stats.firstCallAt).toBeNull()
    expect(stats.last30d).toMatchObject({
      calls: 0,
      serverCount: 0,
      sessionCount: 0,
      byServer: [],
      byProject: []
    })
  })
})
