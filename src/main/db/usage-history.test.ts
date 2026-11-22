import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { applySchema } from './schema'
import { openUsageArchive } from './usage-archive'
import { archiveUsageHistory } from '../ingest/usage-history'
import { rebuildCostLineages } from '../ingest/cost-lineage'
import {
  getTokenStats,
  getUsageCalendar,
  getUsageDay,
  getArchivedActivityStats
} from './usage-history-queries'
import {
  getUsageOverviewData,
  getProjectUsageCalendar,
  getProjectUsageDay,
  usageSessionPaths
} from '../usage-projects'
import { createProjectIdentity } from '../project-identity'
import { readProjectIdentity } from '../../shared/project-identity'
import { scanTranscripts } from '../ingest/transcript-scanner'
import { scanPromptHistory } from '../ingest/prompt-history-scanner'
import { grantPath, resetGrantedPaths } from '../permissions'

const now = new Date(2026, 10, 3, 12)
const at = (day: number, hour = 10): string => new Date(2026, 10, day, hour).toISOString()
let index: Database.Database
let archive: Database.Database
let directory: string

function session(id = 'session', next: string | null = null): void {
  index
    .prepare(
      `INSERT INTO sessions_meta
    (session_id,cwd,started_at,message_count,source_mtime_ms,continued_in_session_id)
    VALUES (?, '/repo', ?, 2, 0, ?)`
    )
    .run(id, at(1), next)
}
function totals(id = 'session', input = 100, output = 200): void {
  index.prepare('INSERT INTO session_cost (session_id,total_cost_usd) VALUES (?, 1)').run(id)
  index
    .prepare(
      `INSERT INTO session_model_cost VALUES (?, 'claude-sonnet-5', 1, ?, ?, 50, 300, 400, 0)`
    )
    .run(id, input, output)
}
function turn(id: string, day: number, weight: number, owner = 'session', hour = 10): void {
  index
    .prepare(
      `INSERT INTO turn_usage
    (logical_turn_key,source_uuid,session_id,turn_index,model,input_tokens,output_tokens,
     cache_read_tokens,cache_creation_tokens,cache_creation_5m_tokens,cache_creation_1h_tokens,invoked_at)
    VALUES (?, ?, ?, 0, 'claude-sonnet-5', ?, ?, ?, ?, 0, 0, ?)`
    )
    .run(id, id, owner, weight, weight, weight, weight, at(day, hour))
}
function prompt(timestamp = at(3), owner = 'session', slash = 0): void {
  index.prepare("INSERT INTO prompt_history VALUES (?, '/repo', ?, ?)").run(owner, timestamp, slash)
}
// The scan rebuilds lineages before archiving; these fixtures write the raw tables directly.
function sync(): void {
  rebuildCostLineages(index)
  archiveUsageHistory(index, archive, { prompts: true, transcripts: true }, now)
}

// p → a and p → b are CLI forks: shared startTime and first record, b under a on every field.
// Lineage tokens: input 10 + 20 + 15 = 45, output 200 + 150 + 100 = 450.
function forkLineage(): void {
  for (const [id, input, output, turns] of [
    ['p', 10, 200, ['t1', 't2']],
    ['a', 30, 350, ['t1', 't2', 'a1']],
    ['b', 25, 300, ['t1', 't2', 'b1']]
  ] as const) {
    session(id)
    index
      .prepare(
        'INSERT INTO session_cost (session_id,total_cost_usd,cost_state_start_time) VALUES (?, ?, ?)'
      )
      .run(id, output / 100, at(1))
    index
      .prepare(`INSERT INTO session_model_cost VALUES (?, 'claude-sonnet-5', ?, ?, ?, 0, 0, 0, 0)`)
      .run(id, output / 100, input, output)
    for (const key of turns) {
      index
        .prepare(
          `INSERT OR IGNORE INTO turn_usage
          (logical_turn_key,source_uuid,session_id,turn_index,model,input_tokens,output_tokens,
           cache_read_tokens,cache_creation_tokens,cache_creation_5m_tokens,cache_creation_1h_tokens,invoked_at)
          VALUES (?, ?, ?, 0, 'claude-sonnet-5', ?, ?, 0, 0, 0, 0, ?)`
        )
        .run(key, key, id, key === 'a1' ? 10 : 5, key === 'a1' ? 150 : 100, at(3))
      index.prepare('INSERT INTO session_turn VALUES (?, ?)').run(id, key)
    }
  }
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'megatron-history-test-'))
  index = new Database(':memory:')
  applySchema(index)
  archive = openUsageArchive(join(directory, 'usage-history.db'))
})
afterEach(() => {
  resetGrantedPaths()
  index.close()
  archive.close()
  rmSync(directory, { recursive: true, force: true })
})

describe('persistent usage history', () => {
  it('keeps Activity aligned with retained History after source pruning, including prompt multiplicity', () => {
    const insert = archive.prepare('INSERT INTO history_prompts VALUES (?, ?, ?, ?, ?)')
    insert.run('first', '/repo/src', at(3), 0, 3)
    insert.run('second', '/repo', at(3, 11), 0, 2)
    insert.run('slash', '/repo', at(3, 11), 1, 4)
    insert.run('future', '/repo', at(4), 0, 100)
    archive
      .prepare('INSERT INTO history_coverage VALUES (?, ?)')
      .run(at(1, 0), new Date(now.getTime() + 1).toISOString())
    const activity = getArchivedActivityStats(archive, now)
    expect(activity.last24h).toMatchObject({
      prompts: 5,
      sessions: 2,
      slashCommands: 4,
      coverage: 'available'
    })
    expect(activity.last24h.hourlyTrend.reduce((sum, hour) => sum + hour.count, 0)).toBe(5)
    expect(activity.last7d.byHour.reduce((sum, count) => sum + count, 0)).toBe(5)
    expect(activity.last7d.byDay.find((day) => day.date === '2026-11-03')).toMatchObject({
      count: 5,
      slashCommands: 4,
      coverage: 'available'
    })
    expect(activity.last7d.coverage).toBe('partial')
    expect(activity.last7d.byDay[0].coverage).toBe('unavailable')
    expect(activity.last30d.prompts).toBe(getUsageCalendar(archive, 2026, now).prompts)
    expect(getUsageDay(archive, '2026-11-03', now).count).toBe(5)
  })

  it('uses identical project ownership for overview metrics, timeline, and day details', () => {
    session()
    index.prepare("UPDATE sessions_meta SET cwd='/repo/src'").run()
    totals()
    index
      .prepare(
        "INSERT INTO timed_skill_cost (session_id, skill_name, model, allocated_at, est_cost_usd) VALUES ('session', NULL, 'claude-sonnet-5', ?, 1)"
      )
      .run(at(3))
    turn('turn', 3, 1)
    prompt()
    index.prepare("UPDATE prompt_history SET project='/repo/prompts'").run()
    sync()
    const owner = createProjectIdentity({
      store: { read: () => [], write: () => undefined },
      claudeCodeFolders: [],
      sessionPaths: () => usageSessionPaths(index, archive),
      catalog: () => [{ path: '/repo', kind: 'repository', status: 'available' }]
    })
    owner.reconcile()
    expect(owner.snapshot().locations).toHaveLength(1)
    const identity = owner.identity()
    const overview = getUsageOverviewData(index, archive, identity, now)
    expect(overview.activity.last30d.byProject).toEqual([{ project: '/repo', count: 1 }])
    expect(overview.tokens.last30d.byProject).toEqual([
      {
        key: '/repo',
        tokens: { input: 100, output: 200, cacheRead: 300, cacheWrite: 400, total: 1000 }
      }
    ])
    expect(overview.cost?.last30d.byProject).toEqual([{ project: '/repo', costUsd: 1 }])
    expect(getProjectUsageCalendar(archive, 2026, identity, now).byProject[0]).toMatchObject({
      project: '/repo',
      total: 1
    })
    expect(getProjectUsageDay(archive, '2026-11-03', identity, now).byProject).toEqual([
      { project: '/repo', count: 1 }
    ])
  })

  it('summarizes recorded activity within the selected local year', () => {
    const insert = archive.prepare('INSERT INTO history_prompts VALUES (?, ?, ?, ?, ?)')
    insert.run('previous', '/repo', new Date(2025, 11, 31, 23).toISOString(), 0, 100)
    insert.run('first', '/repo', new Date(2026, 0, 1, 10).toISOString(), 0, 3)
    insert.run('second', '/repo', new Date(2026, 0, 2, 10).toISOString(), 0, 5)
    insert.run('third', '/repo', new Date(2026, 0, 3, 10).toISOString(), 0, 5)
    insert.run('slash', '/repo', new Date(2026, 0, 3, 11).toISOString(), 1, 80)
    insert.run('future', '/repo', at(4), 0, 100)
    archive
      .prepare('INSERT INTO history_coverage VALUES (?, ?)')
      .run(new Date(2026, 0, 1).toISOString(), new Date(2026, 0, 5).toISOString())

    expect(getUsageCalendar(archive, 2026, now)).toMatchObject({
      prompts: 13,
      activeDays: 3,
      summary: {
        observedDays: 4,
        partialDays: 0,
        elapsedDays: 307,
        longestStreak: { days: 3, startDate: '2026-01-01', endDate: '2026-01-03' },
        busiestDay: { date: '2026-01-02', count: 5 },
        promptsPerActiveDay: 13 / 3
      }
    })
  })

  it('keeps verified streaks separate across missing and known-empty days', () => {
    const insert = archive.prepare('INSERT INTO history_prompts VALUES (?, ?, ?, 0, 1)')
    for (const day of [1, 2, 4, 5, 7]) insert.run(`day-${day}`, '/repo', at(day))
    const cover = archive.prepare('INSERT INTO history_coverage VALUES (?, ?)')
    cover.run(new Date(2026, 10, 1).toISOString(), new Date(2026, 10, 3).toISOString())
    cover.run(new Date(2026, 10, 4, 9).toISOString(), new Date(2026, 10, 8).toISOString())

    expect(getUsageCalendar(archive, 2026, new Date(2026, 10, 8, 12)).summary).toMatchObject({
      observedDays: 6,
      partialDays: 1,
      longestStreak: { days: 2, startDate: '2026-11-01', endDate: '2026-11-02' }
    })
  })

  it('does not invent records or averages when no prompt history is observed', () => {
    expect(getUsageCalendar(archive, 2026, now).summary).toEqual({
      observedDays: 0,
      partialDays: 0,
      elapsedDays: 307,
      longestStreak: null,
      busiestDay: null,
      promptsPerActiveDay: null
    })
  })

  it('groups project months using prompt multiplicity and excludes commands and other years', () => {
    const insert = archive.prepare('INSERT INTO history_prompts VALUES (?, ?, ?, ?, ?)')
    insert.run('jan', '/alpha', new Date(2026, 0, 31, 23, 59).toISOString(), 0, 3)
    insert.run('feb', '/alpha', new Date(2026, 1, 1).toISOString(), 0, 2)
    insert.run('beta', '/beta', new Date(2026, 1, 2).toISOString(), 0, 7)
    insert.run('command', '/beta', new Date(2026, 1, 2, 1).toISOString(), 1, 20)
    insert.run('older', '/beta', new Date(2025, 11, 31).toISOString(), 0, 80)
    insert.run('future', '/beta', at(4), 0, 80)
    archive
      .prepare('INSERT INTO history_coverage VALUES (?, ?)')
      .run(new Date(2026, 1, 1).toISOString(), new Date(2026, 2, 1).toISOString())

    const calendar = getUsageCalendar(archive, 2026, now)
    expect(calendar.byProject).toEqual([
      { project: '/beta', total: 7, byMonth: [0, 7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
      { project: '/alpha', total: 5, byMonth: [3, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }
    ])
    expect(calendar.months).toHaveLength(12)
    expect(calendar.months[0]).toEqual({ month: 1, count: 3, coverage: 'unavailable' })
    expect(calendar.months[1]).toEqual({ month: 2, count: 9, coverage: 'available' })
    expect(calendar.months[11]).toEqual({ month: 12, count: 0, coverage: 'future' })
  })

  it('rejects future day-detail requests instead of returning a reversed interval', () => {
    expect(() => getUsageDay(archive, '2026-11-04', now)).toThrow(/future/i)
  })
  it('ingests JSONL sources through the real scanners and preserves their history after pruning', () => {
    grantPath(directory)
    const projects = join(directory, 'projects')
    const project = join(projects, 'repo')
    mkdirSync(project, { recursive: true })
    const history = join(directory, 'history.jsonl')
    const transcript = [
      {
        type: 'user',
        sessionId: 'jsonl',
        cwd: '/repo',
        timestamp: at(3),
        uuid: 'user',
        isSidechain: false,
        message: { content: 'private prompt' }
      },
      {
        type: 'assistant',
        sessionId: 'jsonl',
        timestamp: at(3),
        uuid: 'response',
        requestId: 'request',
        isSidechain: false,
        message: {
          id: 'message',
          model: 'claude-sonnet-5',
          content: [],
          usage: { input_tokens: 10, output_tokens: 20 }
        }
      },
      {
        type: 'cost-state',
        sessionId: 'jsonl',
        totalCostUSD: 1,
        modelUsage: {
          'claude-sonnet-5': {
            costUSD: 1,
            inputTokens: 100,
            outputTokens: 200,
            thinkingTokens: 50,
            cacheReadInputTokens: 3000,
            cacheCreationInputTokens: 400
          }
        }
      }
    ]
    writeFileSync(
      join(project, 'jsonl.jsonl'),
      transcript.map((line) => JSON.stringify(line)).join('\n')
    )
    writeFileSync(
      history,
      JSON.stringify({
        sessionId: 'jsonl',
        project: '/repo',
        timestamp: Date.parse(at(3)),
        display: 'private prompt'
      })
    )
    expect(scanTranscripts(index, projects).status).toBe('complete')
    expect(scanPromptHistory(index, history).status).toBe('complete')
    sync()
    expect(getTokenStats(archive, now).last24h.tokens?.total).toBe(3700)
    expect(getUsageDay(archive, '2026-11-03', now)).toMatchObject({
      count: 1,
      tokens: { total: 3700 }
    })
    rmSync(project, { recursive: true })
    writeFileSync(history, '')
    scanTranscripts(index, projects)
    scanPromptHistory(index, history)
    sync()
    expect(getUsageDay(archive, '2026-11-03', now)).toMatchObject({
      count: 1,
      tokens: { total: 3700 }
    })
  })
  it('keeps prompts across source pruning, archive reopen, and index rebuild without rescan duplication', () => {
    prompt()
    prompt()
    prompt(at(3), 'session', 1)
    sync()
    sync()
    index.close()
    index = new Database(':memory:')
    applySchema(index)
    archive.close()
    archive = openUsageArchive(join(directory, 'usage-history.db'))
    sync()
    expect(getUsageDay(archive, '2026-11-03', now)).toMatchObject({
      count: 2,
      sessions: 1,
      slashCommands: 1
    })
    expect(getUsageCalendar(archive, 2026, now).prompts).toBe(2)
  })

  it('reconciles category totals across midnight without adding thinking tokens', () => {
    session()
    totals()
    turn('one', 2, 1, 'session', 23)
    turn('two', 3, 3, 'session', 1)
    sync()
    expect(getTokenStats(archive, now).last7d.tokens).toEqual({
      input: 100,
      output: 200,
      cacheRead: 300,
      cacheWrite: 400,
      total: 1000
    })
    expect(getUsageDay(archive, '2026-11-02', now).tokens?.total).toBe(250)
    expect(getUsageDay(archive, '2026-11-03', now).tokens?.total).toBe(750)
    expect(getTokenStats(archive, now).last24h.tokens?.total).toBe(1000)
  })

  it('updates growing sessions while retaining token data after transcript pruning', () => {
    session()
    totals()
    turn('one', 3, 1)
    sync()
    index.prepare('UPDATE session_model_cost SET output_tokens = 250').run()
    sync()
    sync()
    index.prepare('DELETE FROM turn_usage').run()
    index.prepare('DELETE FROM session_cost').run()
    index.prepare('DELETE FROM sessions_meta').run()
    sync()
    expect(getTokenStats(archive, now).last7d.tokens?.total).toBe(1050)
    expect(getTokenStats(archive, now).last7d.byModel).toHaveLength(1)
    expect(getTokenStats(archive, now).last7d.byProject[0].tokens.total).toBe(1050)
  })

  it('collapses continued sessions and excludes duplicate subagent replays', () => {
    session('first', 'last')
    totals('first', 1000, 1000)
    session('last')
    totals('last')
    turn('ancestor', 2, 1, 'first')
    turn('child', 3, 1, 'last')
    sync()
    index
      .prepare(
        "UPDATE turn_usage SET logical_turn_key = 'replayed-child', session_id = 'first' WHERE source_uuid = 'child'"
      )
      .run()
    sync()
    expect(getTokenStats(archive, now).last7d.tokens?.total).toBe(1000)
  })

  it('archives a fork lineage at its head with the lineage tokens, not every fork counter', () => {
    forkLineage()
    sync()
    expect(getTokenStats(archive, now).last7d.tokens).toMatchObject({
      input: 45,
      output: 450,
      total: 495
    })
  })

  it('keeps a pruned head linked so its surviving branches are not counted again', () => {
    forkLineage()
    sync()
    for (const table of ['session_turn', 'turn_usage', 'session_cost', 'sessions_meta'])
      index.prepare(`DELETE FROM ${table} WHERE session_id = 'a'`).run()
    sync()
    expect(getTokenStats(archive, now).last7d.tokens?.total).toBe(495)
  })

  it('does not invent timestamps or token totals for untracked sessions', () => {
    session('undated')
    totals('undated')
    session('untracked')
    turn('unpriced', 3, 1000, 'untracked')
    sync()
    expect(getTokenStats(archive, now)).toMatchObject({
      missingSessionCount: 1,
      undatedTokens: { total: 1000 },
      last7d: { tokens: null }
    })
  })

  it('uses exact rolling cutoffs, excludes future responses, and conserves small integer categories', () => {
    session()
    totals('session', 1, 2)
    const start = new Date(now.getTime() - 86400000).toISOString()
    turn('before', 2, 1)
    turn('cutoff', 2, 1)
    turn('asof', 3, 1)
    turn('future', 4, 1)
    index
      .prepare("UPDATE turn_usage SET invoked_at = ? WHERE logical_turn_key = 'cutoff'")
      .run(start)
    index
      .prepare("UPDATE turn_usage SET invoked_at = ? WHERE logical_turn_key = 'asof'")
      .run(now.toISOString())
    sync()
    const stats = getTokenStats(archive, now)
    expect(stats.last7d.tokens?.total).toBe(526)
    expect(stats.last24h.trend).toHaveLength(24)
    expect(stats.last24h.trend.reduce((sum, bucket) => sum + (bucket.tokens?.total ?? 0), 0)).toBe(
      stats.last24h.tokens?.total
    )
  })

  it('keeps unavailable history distinct from known empty dates, with leap years and a shared scale', () => {
    prompt(new Date(2024, 1, 29, 10).toISOString())
    archiveUsageHistory(
      index,
      archive,
      { prompts: true, transcripts: false },
      new Date(2024, 2, 2, 12)
    )
    index.prepare('DELETE FROM prompt_history').run()
    prompt(at(3))
    prompt(at(3))
    sync()
    const old = getUsageCalendar(archive, 2024, now)
    const current = getUsageCalendar(archive, 2026, now)
    expect(old.days).toHaveLength(366)
    expect(old.years).toEqual([2026, 2024])
    expect(old.days.find((day) => day.date === '2024-01-01')?.coverage).toBe('unavailable')
    expect(old.days.find((day) => day.date === '2024-03-01')).toMatchObject({
      count: 0,
      coverage: 'available'
    })
    expect(current.days.find((day) => day.date === '2026-11-04')?.coverage).toBe('future')
    expect(current.days.find((day) => day.date === '2026-06-01')?.coverage).toBe('unavailable')
    expect(current.thresholds).toEqual(old.thresholds)
  })

  it('does not archive a failed source or claim its coverage', () => {
    prompt()
    session()
    totals()
    turn('one', 3, 1)
    archiveUsageHistory(index, archive, { prompts: false, transcripts: false }, now)
    expect(getUsageCalendar(archive, 2026, now).prompts).toBe(0)
    expect(getUsageDay(archive, '2026-11-03', now).tokens).toBeNull()
  })
})

describe('token bucket details', () => {
  function share(
    timestamp: string,
    project: string,
    model: string,
    counts: [number, number, number, number]
  ): void {
    archive
      .prepare('INSERT INTO history_token_shares VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run('session', project, model, timestamp, ...counts)
  }

  it.each(['last24h', 'last7d', 'last30d'] as const)(
    'reconciles %s bucket breakdowns in every category without including adjacent buckets',
    (windowKey) => {
      const timestamp = new Date(now.getTime() - 2 * 3600000).toISOString()
      share(timestamp, '/repo/a', 'sonnet', [1, 2, 3, 4])
      share(timestamp, '/repo/b', 'sonnet', [5, 6, 7, 8])
      share(timestamp, '/repo/a', 'opus', [9, 10, 11, 12])
      share(new Date(now.getTime() - 3600000).toISOString(), '/repo/b', 'sonnet', [13, 14, 15, 16])
      const window = getTokenStats(archive, now)[windowKey]
      const bucket = window.trend.find(
        (candidate) => candidate.startAt <= timestamp && candidate.endAt > timestamp
      )!
      expect(bucket.tokens).toEqual(
        windowKey === 'last24h'
          ? { input: 15, output: 18, cacheRead: 21, cacheWrite: 24, total: 78 }
          : { input: 28, output: 32, cacheRead: 36, cacheWrite: 40, total: 136 }
      )
      expect(bucket.byModel?.map((row) => [row.key, row.tokens.total])).toEqual(
        windowKey === 'last24h'
          ? [
              ['opus', 42],
              ['sonnet', 36]
            ]
          : [
              ['sonnet', 94],
              ['opus', 42]
            ]
      )
      expect(bucket.byProject.map((row) => [row.key, row.tokens.total])).toEqual(
        windowKey === 'last24h'
          ? [
              ['/repo/a', 52],
              ['/repo/b', 26]
            ]
          : [
              ['/repo/b', 84],
              ['/repo/a', 52]
            ]
      )
      for (const category of ['input', 'output', 'cacheRead', 'cacheWrite', 'total'] as const) {
        expect(window.trend.reduce((sum, row) => sum + (row.tokens?.[category] ?? 0), 0)).toBe(
          window.tokens![category]
        )
        for (const dimension of ['byModel', 'byProject'] as const) {
          expect(bucket[dimension].reduce((sum, row) => sum + row.tokens[category], 0)).toBe(
            bucket.tokens![category]
          )
        }
      }
    }
  )

  it('keeps unrecorded buckets distinct from recorded zero totals', () => {
    const timestamp = new Date(now.getTime() - 3600000).toISOString()
    share(timestamp, '/repo', 'sonnet', [0, 0, 0, 0])
    const buckets = getTokenStats(archive, now).last24h.trend
    expect(buckets[0]).toMatchObject({ tokens: null, byModel: [], byProject: [] })
    expect(buckets.find((bucket) => bucket.startAt === timestamp)).toMatchObject({
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      byModel: [{ key: 'sonnet', tokens: { total: 0 } }],
      byProject: [{ key: '/repo', tokens: { total: 0 } }]
    })
  })

  it('clips bucket details to the rolling cutoff and includes the as-of instant only once', () => {
    const cutoff = now.getTime() - 86400000
    for (const [time, input] of [
      [cutoff - 1, 1],
      [cutoff, 2],
      [cutoff + 3600000, 4],
      [now.getTime(), 8],
      [now.getTime() + 1, 16]
    ])
      share(new Date(time).toISOString(), '/repo', 'sonnet', [input, 0, 0, 0])
    const window = getTokenStats(archive, now).last24h
    expect(window.trend[0]).toMatchObject({
      startAt: new Date(cutoff).toISOString(),
      tokens: { total: 2 },
      byModel: [{ key: 'sonnet', tokens: { total: 2 } }]
    })
    expect(window.trend[1].byProject).toMatchObject([{ key: '/repo', tokens: { total: 4 } }])
    expect(window.trend.at(-1)).toMatchObject({
      endAt: new Date(now.getTime() + 1).toISOString(),
      tokens: { total: 8 }
    })
    expect(window.tokens?.total).toBe(14)
  })

  it.each(['last7d', 'last30d'] as const)('marks only clipped local days partial in %s', (key) => {
    const buckets = getTokenStats(archive, now)[key].trend
    expect(buckets[0].partial).toBe(true)
    expect(buckets.at(-1)?.partial).toBe(true)
    expect(buckets.slice(1, -1).every((bucket) => bucket.partial === false)).toBe(true)
  })

  it('groups bucket projects under canonical checkouts while preserving nested repositories', () => {
    const timestamp = new Date(now.getTime() - 3600000).toISOString()
    for (const [project, input] of [
      ['c:/HQ/Repo/src/', 1],
      ['C:\\HQ\\Worktree\\src', 2],
      ['C:\\HQ\\Repo\\Child\\src', 4]
    ] as const)
      share(timestamp, project, 'sonnet', [input, input, input, input])
    const locations = [
      { id: 'repo', path: 'C:\\HQ\\Repo', kind: 'repository', status: 'available' },
      {
        id: 'worktree',
        path: 'C:\\HQ\\Worktree',
        kind: 'repository',
        status: 'missing',
        linkedTo: 'repo',
        worktree: true
      },
      { id: 'child', path: 'C:\\HQ\\Repo\\Child', kind: 'repository', status: 'needs_access' }
    ] as const
    const overview = getUsageOverviewData(
      index,
      archive,
      readProjectIdentity({ locations: [...locations], claudeCodeFolders: [] }),
      now
    )
    for (const window of [
      overview.tokens.last24h,
      overview.tokens.last7d,
      overview.tokens.last30d
    ]) {
      expect(window.trend.find((bucket) => bucket.tokens !== null)?.byProject).toEqual([
        {
          key: 'C:\\HQ\\Repo\\Child',
          tokens: { input: 4, output: 4, cacheRead: 4, cacheWrite: 4, total: 16 }
        },
        {
          key: 'C:\\HQ\\Repo',
          tokens: { input: 3, output: 3, cacheRead: 3, cacheWrite: 3, total: 12 }
        }
      ])
      expect(window.tokens?.total).toBe(28)
    }
  })
})

describe('usage history across a skipped local midnight', () => {
  let previousTimezone: string | undefined

  beforeEach(() => {
    previousTimezone = process.env.TZ
    process.env.TZ = 'America/Santiago'
  })

  afterEach(() => {
    if (previousTimezone === undefined) delete process.env.TZ
    else process.env.TZ = previousTimezone
  })

  it('ends day details and coverage at the following midnight without counting the next day', () => {
    const insertPrompt = archive.prepare('INSERT INTO history_prompts VALUES (?, ?, ?, 0, 1)')
    insertPrompt.run('on-day', '/repo', '2026-09-06T13:00:00.000Z')
    insertPrompt.run('next-day', '/repo', '2026-09-07T03:30:00.000Z')
    const insertTokens = archive.prepare(
      "INSERT INTO history_token_shares VALUES (?, '/repo', 'claude-sonnet-5', ?, 10, 20, 30, 40)"
    )
    insertTokens.run('on-day', '2026-09-06T13:00:00.000Z')
    insertTokens.run('next-day', '2026-09-07T03:30:00.000Z')
    archive
      .prepare('INSERT INTO history_coverage VALUES (?, ?)')
      .run('2026-09-06T04:00:00.000Z', '2026-09-07T03:00:00.000Z')
    const asOf = new Date('2026-09-08T15:00:00.000Z')

    expect(getUsageDay(archive, '2026-09-06', asOf)).toMatchObject({
      startAt: '2026-09-06T04:00:00.000Z',
      endAt: '2026-09-07T03:00:00.000Z',
      count: 1,
      sessions: 1,
      byProject: [{ project: '/repo', count: 1 }],
      coverage: 'available',
      partial: false,
      tokens: { input: 10, output: 20, cacheRead: 30, cacheWrite: 40, total: 100 }
    })
    expect(
      getUsageCalendar(archive, 2026, asOf).days.find((day) => day.date === '2026-09-06')
    ).toMatchObject({ coverage: 'available', tokens: { total: 100 } })
  })

  it.each(['last7d', 'last30d'] as const)(
    'keeps %s day buckets at local midnight and includes the current early-morning tokens',
    (windowKey) => {
      const insertTokens = archive.prepare(
        "INSERT INTO history_token_shares VALUES ('session', '/repo', 'claude-sonnet-5', ?, ?, 0, 0, 0)"
      )
      insertTokens.run('2026-09-06T13:00:00.000Z', 100)
      insertTokens.run('2026-09-07T03:30:00.000Z', 200)
      insertTokens.run('2026-09-08T03:15:00.000Z', 300)

      const window = getTokenStats(archive, new Date('2026-09-08T03:30:00.000Z'))[windowKey]
      expect(
        window.trend
          .filter((bucket) => bucket.key >= '2026-09-06')
          .map((bucket) => ({
            date: bucket.key,
            start: bucket.startAt,
            end: bucket.endAt,
            total: bucket.tokens?.total,
            partial: bucket.partial,
            models: bucket.byModel?.map((row) => row.tokens.total)
          }))
      ).toEqual([
        {
          date: '2026-09-06',
          start: '2026-09-06T04:00:00.000Z',
          end: '2026-09-07T03:00:00.000Z',
          total: 100,
          partial: false,
          models: [100]
        },
        {
          date: '2026-09-07',
          start: '2026-09-07T03:00:00.000Z',
          end: '2026-09-08T03:00:00.000Z',
          total: 200,
          partial: false,
          models: [200]
        },
        {
          date: '2026-09-08',
          start: '2026-09-08T03:00:00.000Z',
          end: '2026-09-08T03:30:00.001Z',
          total: 300,
          partial: true,
          models: [300]
        }
      ])
      expect(window.tokens?.total).toBe(600)
      expect(window.trend.reduce((sum, bucket) => sum + (bucket.tokens?.total ?? 0), 0)).toBe(600)
    }
  )
})

describe('token bucket details across daylight-saving changes', () => {
  let previousTimezone: string | undefined

  beforeEach(() => {
    previousTimezone = process.env.TZ
    process.env.TZ = 'America/New_York'
  })

  afterEach(() => {
    if (previousTimezone === undefined) delete process.env.TZ
    else process.env.TZ = previousTimezone
  })

  it.each([
    { date: '2026-03-08', start: '2026-03-08T05:00:00.000Z', end: '2026-03-09T04:00:00.000Z' },
    { date: '2026-11-01', start: '2026-11-01T04:00:00.000Z', end: '2026-11-02T05:00:00.000Z' }
  ])(
    'keeps the full local day $date together regardless of its duration',
    ({ date, start, end }) => {
      const insert = archive.prepare(
        "INSERT INTO history_token_shares VALUES ('session', '/repo', 'sonnet', ?, ?, 0, 0, 0)"
      )
      insert.run(start, 1)
      insert.run(new Date(Date.parse(end) - 1).toISOString(), 2)
      insert.run(end, 4)
      const window = getTokenStats(archive, new Date(Date.parse(end) + 86400000)).last7d
      expect(window.trend.find((bucket) => bucket.key === date)).toMatchObject({
        startAt: start,
        endAt: end,
        partial: false,
        tokens: { total: 3 },
        byModel: [{ key: 'sonnet', tokens: { total: 3 } }],
        byProject: [{ key: '/repo', tokens: { total: 3 } }]
      })
    }
  )
})

describe('archived skill invocations and MCP calls', () => {
  interface CallResult {
    is_error: number | null
    is_denied: number | null
    result_chars: number | null
    result_images: number | null
  }
  const NO_RESULT: CallResult = {
    is_error: null,
    is_denied: null,
    result_chars: null,
    result_images: null
  }

  function invocation(uuid: string, owner = 'session'): void {
    index
      .prepare(
        `INSERT INTO skill_invocations (source_uuid, session_id, skill_name, args_text, invoked_at,
           trigger_type, agent_id, preceding_user_text)
         VALUES (?, ?, 'deploy', 'token=abc', ?, 'user_invoked', 'agent-1', 'deploy with my key')`
      )
      .run(uuid, owner, at(3))
  }
  function mcpCall(id: string, result: CallResult = NO_RESULT, owner = 'session'): void {
    index
      .prepare(
        `INSERT INTO mcp_tool_calls (tool_use_id, session_id, cwd, qualified_name, invoked_at,
           agent_id, is_error, is_denied, result_chars, result_images)
         VALUES (@id, @owner, '/repo/packages/api', 'github__create_issue', @invokedAt, NULL,
           @is_error, @is_denied, @result_chars, @result_images)`
      )
      .run({ id, owner, invokedAt: at(3, 11), ...result })
  }
  function lastTouched(id: string, day: number): void {
    index
      .prepare('UPDATE sessions_meta SET source_mtime_ms = ? WHERE session_id = ?')
      .run(new Date(2026, 10, day, 9).getTime(), id)
  }
  function archiveTranscripts(at: Date): void {
    archiveUsageHistory(index, archive, { prompts: false, transcripts: true }, at)
  }
  function pruneTranscripts(): void {
    index.exec(
      'DELETE FROM skill_invocations; DELETE FROM mcp_tool_calls; DELETE FROM sessions_meta'
    )
  }
  const archivedInvocations = (): unknown[] =>
    archive.prepare('SELECT * FROM history_skill_invocations').all()
  const archivedCalls = (): unknown[] => archive.prepare('SELECT * FROM history_mcp_calls').all()
  const coverage = (): unknown[] =>
    archive
      .prepare('SELECT start_at, end_at FROM history_transcript_coverage ORDER BY start_at')
      .all()

  it('archives what the real transcript scanner reads, and none of its content', () => {
    grantPath(directory)
    const projects = join(directory, 'projects')
    const project = join(projects, 'repo')
    mkdirSync(project, { recursive: true })
    const line = (fields: Record<string, unknown>): Record<string, unknown> => ({
      sessionId: 'real',
      cwd: '/repo',
      timestamp: at(3),
      isSidechain: false,
      ...fields
    })
    writeFileSync(
      join(project, 'real.jsonl'),
      [
        line({ type: 'user', uuid: 'prompt', message: { content: 'use SECRET-PROMPT' } }),
        line({
          type: 'assistant',
          uuid: 'skill-line',
          message: {
            content: [
              {
                type: 'tool_use',
                id: 'skill-block',
                name: 'Skill',
                input: { skill: 'deploy', args: 'SECRET-ARGS' }
              }
            ]
          }
        }),
        line({
          type: 'assistant',
          uuid: 'mcp-line',
          message: {
            content: [
              {
                type: 'tool_use',
                id: 'mcp-block',
                name: 'mcp__github__create_issue',
                input: { body: 'SECRET-INPUT' }
              }
            ]
          }
        }),
        line({
          type: 'user',
          uuid: 'mcp-result',
          message: {
            content: [{ type: 'tool_result', tool_use_id: 'mcp-block', content: 'SECRET-RESULT' }]
          }
        })
      ]
        .map((record) => JSON.stringify(record))
        .join('\n')
    )
    expect(scanTranscripts(index, projects).status).toBe('complete')
    sync()
    rmSync(project, { recursive: true })
    expect(scanTranscripts(index, projects).status).toBe('complete')
    sync()

    expect(archivedInvocations()).toMatchObject([
      { source_uuid: 'skill-line', session_id: 'real', project: '/repo', skill_name: 'deploy' }
    ])
    expect(archivedCalls()).toMatchObject([
      {
        tool_use_id: 'mcp-block',
        qualified_name: 'github__create_issue',
        is_error: 0,
        result_chars: 'SECRET-RESULT'.length
      }
    ])
    archive.pragma('wal_checkpoint(TRUNCATE)')
    const bytes = readFileSync(join(directory, 'usage-history.db')).toString('latin1')
    expect(bytes).not.toMatch(/SECRET-/)
  })

  it("copies an invocation's metadata once, never its args or the prompt before it", () => {
    session()
    invocation('u1')
    sync()
    sync()
    expect(archivedInvocations()).toEqual([
      {
        source_uuid: 'u1',
        session_id: 'session',
        project: '/repo',
        skill_name: 'deploy',
        invoked_at: at(3),
        trigger_type: 'user_invoked',
        agent_id: 'agent-1'
      }
    ])
  })

  it("copies an MCP call's metadata with its own folder and its session's", () => {
    session()
    mcpCall('t1', { is_error: 0, is_denied: 0, result_chars: 1200, result_images: 1 })
    sync()
    expect(archivedCalls()).toEqual([
      {
        tool_use_id: 't1',
        session_id: 'session',
        cwd: '/repo/packages/api',
        project: '/repo',
        qualified_name: 'github__create_issue',
        invoked_at: at(3, 11),
        agent_id: null,
        is_error: 0,
        is_denied: 0,
        result_chars: 1200,
        result_images: 1
      }
    ])
  })

  it('keeps both after Claude Code prunes their transcript', () => {
    session()
    invocation('u1')
    mcpCall('t1')
    sync()
    pruneTranscripts()
    sync()
    expect(archivedInvocations()).toHaveLength(1)
    expect(archivedCalls()).toHaveLength(1)
  })

  it("takes the index's current reading of a row it still holds", () => {
    session()
    invocation('u1')
    sync()
    index.prepare("UPDATE skill_invocations SET trigger_type = 'autonomous'").run()
    sync()
    expect(archivedInvocations()).toMatchObject([{ trigger_type: 'autonomous' }])
  })

  it('fills in a result recorded after the call was archived, and never clears one', () => {
    session()
    mcpCall('t1')
    sync()
    expect(archivedCalls()).toMatchObject([NO_RESULT])
    const result = { is_error: 1, is_denied: 0, result_chars: 40, result_images: 0 }
    index.prepare('DELETE FROM mcp_tool_calls').run()
    mcpCall('t1', result)
    sync()
    expect(archivedCalls()).toMatchObject([result])
    index.prepare('DELETE FROM mcp_tool_calls').run()
    mcpCall('t1')
    sync()
    expect(archivedCalls()).toMatchObject([result])
  })

  it('leaves calls and transcript coverage alone when only prompts are archived', () => {
    session()
    invocation('u1')
    mcpCall('t1')
    archiveUsageHistory(index, archive, { prompts: true, transcripts: false }, now)
    expect(archivedInvocations()).toEqual([])
    expect(archivedCalls()).toEqual([])
    expect(coverage()).toEqual([])
  })

  it('covers from the oldest retained transcript to now', () => {
    session('older')
    session('newer')
    lastTouched('older', 1)
    lastTouched('newer', 2)
    archiveTranscripts(now)
    expect(coverage()).toEqual([
      {
        start_at: new Date(2026, 10, 1, 9).toISOString(),
        end_at: new Date(now.getTime() + 1).toISOString()
      }
    ])
  })

  it('covers only the moment of the scan when no transcript is retained', () => {
    archiveTranscripts(now)
    expect(coverage()).toEqual([
      { start_at: now.toISOString(), end_at: new Date(now.getTime() + 1).toISOString() }
    ])
  })

  it('merges overlapping coverage and keeps the gap left by transcripts pruned unseen', () => {
    session()
    lastTouched('session', 1)
    archiveTranscripts(new Date(2026, 10, 3, 12))
    // Megatron didn't run while Claude Code pruned everything up to the 10th.
    lastTouched('session', 10)
    archiveTranscripts(new Date(2026, 10, 12, 12))
    lastTouched('session', 11)
    archiveTranscripts(new Date(2026, 10, 14, 12))
    expect(coverage()).toEqual([
      {
        start_at: new Date(2026, 10, 1, 9).toISOString(),
        end_at: new Date(new Date(2026, 10, 3, 12).getTime() + 1).toISOString()
      },
      {
        start_at: new Date(2026, 10, 10, 9).toISOString(),
        end_at: new Date(new Date(2026, 10, 14, 12).getTime() + 1).toISOString()
      }
    ])
  })
})
