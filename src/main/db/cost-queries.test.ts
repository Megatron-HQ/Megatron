import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applySchema } from './schema'
import { getCostStats } from './queries'

const NOW = new Date('2026-09-07T12:00:00.000Z')
let db: Database.Database

function addSession(
  sessionId: string,
  total: number,
  options: { project?: string; continuedInto?: string; zeroed?: number; unknown?: number } = {}
): void {
  db.prepare(
    `INSERT INTO sessions_meta
       (session_id, cwd, started_at, message_count, source_mtime_ms, continued_in_session_id)
     VALUES (?, ?, '2026-08-01T00:00:00.000Z', 1, 0, ?)`
  ).run(sessionId, options.project ?? '/repo-a', options.continuedInto ?? null)
  db.prepare(
    `INSERT INTO session_cost (session_id, total_cost_usd, is_zeroed, has_unknown_model_cost)
     VALUES (?, ?, ?, ?)`
  ).run(sessionId, total, options.zeroed ?? 0, options.unknown ?? 0)
}

function addShare(
  sessionId: string,
  timestamp: string,
  cost: number,
  model: string | null = 'claude-opus-5'
): void {
  db.prepare(
    `INSERT INTO timed_skill_cost (session_id, skill_name, model, allocated_at, est_cost_usd)
     VALUES (?, NULL, ?, ?, ?)`
  ).run(sessionId, model, timestamp, cost)
}

beforeEach(() => {
  db = new Database(':memory:')
  applySchema(db)
})

afterEach(() => db.close())

describe('rolling Cost windows', () => {
  it('uses activity time for an old session that crosses rolling cutoffs', () => {
    addSession('overnight', 10)
    addShare('overnight', '2026-08-20T12:00:00.000Z', 2)
    addShare('overnight', '2026-09-03T12:00:00.000Z', 3)
    addShare('overnight', '2026-09-07T11:00:00.000Z', 5)
    expect(getCostStats(db, NOW)).toMatchObject({
      totalTrackedCostUsd: 10,
      undatedCostUsd: 0,
      last24h: { totalCostUsd: 5, pricedSessionCount: 1 },
      last7d: { totalCostUsd: 8, pricedSessionCount: 1 },
      last30d: { totalCostUsd: 10, pricedSessionCount: 1 }
    })
  })

  it('includes the exact cutoff and as-of instant but excludes future shares', () => {
    addSession('edges', 15)
    addShare('edges', '2026-09-06T11:59:59.999Z', 1)
    addShare('edges', '2026-09-06T12:00:00.000Z', 2)
    addShare('edges', NOW.toISOString(), 4)
    addShare('edges', '2026-09-07T12:00:00.001Z', 8)
    expect(getCostStats(db, NOW)).toMatchObject({
      last24h: {
        startAt: '2026-09-06T12:00:00.000Z',
        endAt: '2026-09-07T12:00:00.001Z',
        totalCostUsd: 6
      }
    })
  })

  it('excludes zeroed and nonterminal shares and their unknown-model warnings', () => {
    addSession('terminal', 3)
    addSession('predecessor', 100, { continuedInto: 'terminal', unknown: 1 })
    addSession('zeroed', 20, { zeroed: 1, unknown: 1 })
    for (const [id, cost] of [
      ['terminal', 3],
      ['predecessor', 100],
      ['zeroed', 20]
    ] as const) {
      addShare(id, '2026-09-07T11:00:00.000Z', cost)
    }
    expect(getCostStats(db, NOW)).toMatchObject({
      last24h: { totalCostUsd: 3, pricedSessionCount: 1, hasUnknownModelCost: false }
    })
  })

  it('reports untimed cost separately and keeps an empty period selectable', () => {
    addSession('undated', 7)
    expect(getCostStats(db, NOW)).toMatchObject({
      undatedCostUsd: 7,
      undatedSessionCount: 1,
      last24h: { totalCostUsd: 0, pricedSessionCount: 0, byModel: [], byProject: [] }
    })
  })

  it('scopes unknown-model warnings to sessions contributing to each window', () => {
    addSession('older', 2, { unknown: 1 })
    addShare('older', '2026-09-01T12:00:00.000Z', 2)
    expect(getCostStats(db, NOW)).toMatchObject({
      last24h: { hasUnknownModelCost: false },
      last7d: { hasUnknownModelCost: true }
    })
  })

  it('reconciles daily details, project/model splits and punchcard margins', () => {
    addSession('a', 6)
    addSession('b', 4, { project: '/repo-b' })
    addShare('a', '2026-09-03T12:00:00.000Z', 2)
    addShare('a', '2026-09-07T11:00:00.000Z', 4)
    addShare('b', '2026-09-07T11:00:00.000Z', 3, 'claude-sonnet-5')
    addShare('b', '2026-09-07T11:00:00.000Z', 1, null)
    const stats = getCostStats(db, NOW)!
    expect(stats).toHaveProperty('last7d')
    const window = stats.last7d
    expect(window.byModel).toEqual([
      { model: 'claude-opus-5', costUsd: 6 },
      { model: 'claude-sonnet-5', costUsd: 3 },
      { model: 'unattributed', costUsd: 1 }
    ])
    expect(window.byProject).toEqual([
      { project: '/repo-a', costUsd: 6 },
      { project: '/repo-b', costUsd: 4 }
    ])
    expect(window.byDay.reduce((sum, day) => sum + day.costUsd, 0)).toBe(10)
    expect(window.byHour.reduce((sum, value) => sum + value, 0)).toBe(10)
    expect(window.byWeekday.reduce((sum, value) => sum + value, 0)).toBe(10)
    expect(window.byHourWeekday.flat().reduce((sum, value) => sum + value, 0)).toBe(10)
    const today = window.byDay.at(-1)!
    expect(today.costUsd).toBe(8)
    expect(today.pricedSessionCount).toBe(2)
    expect(today.byModel.reduce((sum, model) => sum + model.costUsd, 0)).toBe(8)
    expect(today.byProject.reduce((sum, project) => sum + project.costUsd, 0)).toBe(8)
  })

  it('clips local edge dates to the rolling period and includes their spend', () => {
    const now = new Date(2026, 8, 7, 12)
    const cutoff = new Date(now.getTime() - 7 * 86_400_000)
    addSession('edge', 5)
    addShare('edge', cutoff.toISOString(), 5)
    const stats = getCostStats(db, now)!
    expect(stats).toHaveProperty('last7d')
    const days = stats.last7d.byDay
    expect(days).toHaveLength(8)
    expect(days[0]).toMatchObject({
      date: '2026-08-31',
      costUsd: 5,
      startAt: cutoff.toISOString(),
      partial: true
    })
    expect(days.at(-1)).toMatchObject({
      date: '2026-09-07',
      partial: true,
      endAt: new Date(now.getTime() + 1).toISOString()
    })
    expect(days.slice(1, -1).every((day) => !day.partial)).toBe(true)
  })

  it('zero-fills exactly 24 chronological hourly buckets', () => {
    addSession('hourly', 6)
    addShare('hourly', '2026-09-06T12:00:00.000Z', 2)
    addShare('hourly', '2026-09-07T11:59:59.000Z', 4)
    const stats = getCostStats(db, NOW)!
    expect(stats).toHaveProperty('last24h')
    expect(stats.last24h.byHourChronological).toHaveLength(24)
    expect(stats.last24h.byHourChronological[0]).toMatchObject({ costUsd: 2 })
    expect(stats.last24h.byHourChronological.at(-1)).toMatchObject({ costUsd: 4 })
    expect(stats.last24h.byHourChronological.slice(1, -1).every((hour) => hour.costUsd === 0)).toBe(
      true
    )
  })

  it('scopes hourly details to contributing shares and counts each session once', () => {
    addSession('a', 7)
    addSession('b', 4, { project: '/repo-b', unknown: 1 })
    addShare('a', '2026-09-07T10:10:00.000Z', 2)
    addShare('a', '2026-09-07T10:20:00.000Z', 3, 'claude-sonnet-5')
    addShare('a', '2026-09-07T11:10:00.000Z', 2)
    addShare('b', '2026-09-07T10:30:00.000Z', 4, null)
    const hours = getCostStats(db, NOW)!.last24h.byHourChronological
    expect(hours[22]).toMatchObject({
      costUsd: 9,
      pricedSessionCount: 2,
      hasUnknownModelCost: true,
      byModel: [
        { model: 'unattributed', costUsd: 4 },
        { model: 'claude-sonnet-5', costUsd: 3 },
        { model: 'claude-opus-5', costUsd: 2 }
      ],
      byProject: [
        { project: '/repo-a', costUsd: 5 },
        { project: '/repo-b', costUsd: 4 }
      ]
    })
    expect(hours[23]).toMatchObject({
      costUsd: 2,
      pricedSessionCount: 1,
      hasUnknownModelCost: false,
      byModel: [{ model: 'claude-opus-5', costUsd: 2 }],
      byProject: [{ project: '/repo-a', costUsd: 2 }]
    })
    expect(hours[0]).toMatchObject({
      costUsd: 0,
      pricedSessionCount: 0,
      hasUnknownModelCost: false,
      byModel: [],
      byProject: []
    })
  })

  it('keeps hourly details within rolling boundaries including the as-of instant', () => {
    addSession('edges', 31)
    addShare('edges', '2026-09-06T12:30:59.999Z', 1)
    addShare('edges', '2026-09-06T12:31:00.000Z', 2)
    addShare('edges', '2026-09-06T13:31:00.000Z', 4, 'claude-sonnet-5')
    addShare('edges', '2026-09-07T12:31:00.000Z', 8, null)
    addShare('edges', '2026-09-07T12:31:00.001Z', 16)
    const window = getCostStats(db, new Date('2026-09-07T12:31:00.000Z'))!.last24h
    expect(window.byHourChronological[0]).toMatchObject({
      startAt: '2026-09-06T12:31:00.000Z',
      endAt: '2026-09-06T13:31:00.000Z',
      costUsd: 2,
      byModel: [{ model: 'claude-opus-5', costUsd: 2 }]
    })
    expect(window.byHourChronological[1]).toMatchObject({
      costUsd: 4,
      byModel: [{ model: 'claude-sonnet-5', costUsd: 4 }]
    })
    expect(window.byHourChronological[23]).toMatchObject({
      endAt: '2026-09-07T12:31:00.001Z',
      costUsd: 8,
      byModel: [{ model: 'unattributed', costUsd: 8 }]
    })
    expect(window.totalCostUsd).toBe(14)
    expect(window.byHourChronological.reduce((total, hour) => total + hour.costUsd, 0)).toBe(14)
  })

  it('groups repeated DST hours into the local punchcard without losing daily cost', () => {
    const previousTimezone = process.env.TZ
    process.env.TZ = 'America/Chicago'
    try {
      addSession('dst', 5)
      addShare('dst', '2026-11-01T06:30:00.000Z', 2)
      addShare('dst', '2026-11-01T07:30:00.000Z', 3)
      const stats = getCostStats(db, new Date('2026-11-02T12:00:00.000Z'))!
      expect(stats).toHaveProperty('last7d')
      expect(stats.last7d.byHourWeekday[0][1]).toBe(5)
      expect(stats.last7d.byDay.find((day) => day.date === '2026-11-01')?.costUsd).toBe(5)
      const hours = getCostStats(db, new Date('2026-11-01T12:00:00.000Z'))!.last24h
        .byHourChronological
      expect(hours[18]).toMatchObject({
        startAt: '2026-11-01T06:00:00.000Z',
        costUsd: 2,
        byModel: [{ model: 'claude-opus-5', costUsd: 2 }]
      })
      expect(hours[19]).toMatchObject({
        startAt: '2026-11-01T07:00:00.000Z',
        costUsd: 3,
        byModel: [{ model: 'claude-opus-5', costUsd: 3 }]
      })
    } finally {
      if (previousTimezone === undefined) delete process.env.TZ
      else process.env.TZ = previousTimezone
    }
  })
})
