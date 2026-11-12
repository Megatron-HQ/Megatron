import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
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
  readUsageProjectLocations
} from '../usage-projects'
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
  archiveUsageHistory(index, archive, { prompts: true, tokens: true }, now)
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
    const locations = readUsageProjectLocations(
      index,
      archive,
      [],
      [{ path: '/repo', kind: 'repository', status: 'available' }]
    )
    expect(locations).toHaveLength(1)
    const overview = getUsageOverviewData(index, archive, locations, now)
    expect(overview.activity.last30d.byProject).toEqual([{ project: '/repo', count: 1 }])
    expect(overview.tokens.last30d.byProject).toEqual([
      {
        key: '/repo',
        tokens: { input: 100, output: 200, cacheRead: 300, cacheWrite: 400, total: 1000 }
      }
    ])
    expect(overview.cost?.last30d.byProject).toEqual([{ project: '/repo', costUsd: 1 }])
    expect(getProjectUsageCalendar(archive, 2026, locations, now).byProject[0]).toMatchObject({
      project: '/repo',
      total: 1
    })
    expect(getProjectUsageDay(archive, '2026-11-03', locations, now).byProject).toEqual([
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
    archiveUsageHistory(index, archive, { prompts: true, tokens: false }, new Date(2024, 2, 2, 12))
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
    archiveUsageHistory(index, archive, { prompts: false, tokens: false }, now)
    expect(getUsageCalendar(archive, 2026, now).prompts).toBe(0)
    expect(getUsageDay(archive, '2026-11-03', now).tokens).toBeNull()
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
            total: bucket.tokens?.total
          }))
      ).toEqual([
        {
          date: '2026-09-06',
          start: '2026-09-06T04:00:00.000Z',
          end: '2026-09-07T03:00:00.000Z',
          total: 100
        },
        {
          date: '2026-09-07',
          start: '2026-09-07T03:00:00.000Z',
          end: '2026-09-08T03:00:00.000Z',
          total: 200
        },
        {
          date: '2026-09-08',
          start: '2026-09-08T03:00:00.000Z',
          end: '2026-09-08T03:30:00.001Z',
          total: 300
        }
      ])
      expect(window.tokens?.total).toBe(600)
      expect(window.trend.reduce((sum, bucket) => sum + (bucket.tokens?.total ?? 0), 0)).toBe(600)
    }
  )
})
