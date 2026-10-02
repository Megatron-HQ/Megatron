import type Database from 'better-sqlite3'
import { UNATTRIBUTED_COST_MODEL } from '../../shared/ipc'
import type { CostDay, CostStats, CostWindow } from '../../shared/ipc'

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
const COST_EPSILON = 0.000001
const PRICED_TERMINAL = 'sc.is_zeroed = 0 AND sm.continued_in_session_id IS NULL'

interface TimedCostRow {
  sessionId: string
  project: string
  model: string | null
  allocatedAt: string
  costUsd: number
  unknownModel: number
}

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function summarizeShares(
  rows: TimedCostRow[]
): Pick<
  CostWindow,
  'totalCostUsd' | 'pricedSessionCount' | 'hasUnknownModelCost' | 'byModel' | 'byProject'
> {
  const models = new Map<string, number>()
  const projects = new Map<string, number>()
  const sessions = new Set<string>()
  let totalCostUsd = 0
  let hasUnknownModelCost = false
  for (const row of rows) {
    const model = row.model ?? UNATTRIBUTED_COST_MODEL
    models.set(model, (models.get(model) ?? 0) + row.costUsd)
    projects.set(row.project, (projects.get(row.project) ?? 0) + row.costUsd)
    sessions.add(row.sessionId)
    totalCostUsd += row.costUsd
    hasUnknownModelCost ||= row.unknownModel === 1
  }
  return {
    totalCostUsd,
    pricedSessionCount: sessions.size,
    hasUnknownModelCost,
    byModel: [...models]
      .map(([model, costUsd]) => ({ model, costUsd }))
      .sort((a, b) => b.costUsd - a.costUsd || a.model.localeCompare(b.model)),
    byProject: [...projects]
      .map(([project, costUsd]) => ({ project, costUsd }))
      .sort((a, b) => b.costUsd - a.costUsd || a.project.localeCompare(b.project))
  }
}

function buildDailyCost(rows: TimedCostRow[], startAt: Date, endAt: Date): CostDay[] {
  const rowsByDate = new Map<string, TimedCostRow[]>()
  for (const row of rows) {
    const key = localDateKey(new Date(row.allocatedAt))
    const dayRows = rowsByDate.get(key) ?? []
    dayRows.push(row)
    rowsByDate.set(key, dayRows)
  }
  const cursor = new Date(startAt)
  cursor.setHours(0, 0, 0, 0)
  const buckets: CostDay[] = []
  while (cursor < endAt) {
    const nextDay = new Date(cursor)
    nextDay.setDate(nextDay.getDate() + 1)
    const date = localDateKey(cursor)
    const summary = summarizeShares(rowsByDate.get(date) ?? [])
    buckets.push({
      date,
      weekday: cursor.getDay(),
      costUsd: summary.totalCostUsd,
      pricedSessionCount: summary.pricedSessionCount,
      hasUnknownModelCost: summary.hasUnknownModelCost,
      byModel: summary.byModel,
      byProject: summary.byProject,
      startAt: new Date(Math.max(cursor.getTime(), startAt.getTime())).toISOString(),
      endAt: new Date(Math.min(nextDay.getTime(), endAt.getTime())).toISOString(),
      partial: cursor < startAt || nextDay > endAt
    })
    cursor.setTime(nextDay.getTime())
  }
  return buckets
}

function buildCostWindow(rows: TimedCostRow[], now: Date, days: 1 | 7 | 30): CostWindow {
  const startAt = new Date(now.getTime() - days * DAY_MS)
  const endAt = new Date(now.getTime() + 1)
  const inWindow = rows.filter(
    (row) => row.allocatedAt >= startAt.toISOString() && row.allocatedAt < endAt.toISOString()
  )
  const byHourWeekday = Array.from({ length: 7 }, () => Array<number>(24).fill(0))
  const byHourChronological =
    days === 1
      ? Array.from({ length: 24 }, (_, index) => ({
          startAt: new Date(startAt.getTime() + index * HOUR_MS).toISOString(),
          endAt: new Date(
            index === 23 ? endAt.getTime() : startAt.getTime() + (index + 1) * HOUR_MS
          ).toISOString(),
          costUsd: 0
        }))
      : []
  for (const row of inWindow) {
    const timestamp = new Date(row.allocatedAt)
    byHourWeekday[timestamp.getDay()][timestamp.getHours()] += row.costUsd
    if (days === 1) {
      const index = Math.min(23, Math.floor((timestamp.getTime() - startAt.getTime()) / HOUR_MS))
      byHourChronological[index].costUsd += row.costUsd
    }
  }
  return {
    days,
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
    ...summarizeShares(inWindow),
    byDay: days === 1 ? [] : buildDailyCost(inWindow, startAt, endAt),
    byHourChronological,
    byHourWeekday,
    byHour: Array.from({ length: 24 }, (_, hour) =>
      byHourWeekday.reduce((sum, row) => sum + row[hour], 0)
    ),
    byWeekday: byHourWeekday.map((row) => row.reduce((sum, value) => sum + value, 0))
  }
}

export function getCostStats(db: Database.Database, now: Date = new Date()): CostStats | null {
  const coverageRows = db
    .prepare(
      `SELECT sc.total_cost_usd AS totalCostUsd, sm.started_at AS startedAt,
            COALESCE(timed.total, 0) AS timedCostUsd
     FROM session_cost sc JOIN sessions_meta sm ON sm.session_id = sc.session_id
     LEFT JOIN (SELECT session_id, SUM(est_cost_usd) AS total FROM timed_skill_cost GROUP BY session_id) timed
       ON timed.session_id = sc.session_id
     WHERE ${PRICED_TERMINAL}`
    )
    .all() as Array<{ totalCostUsd: number; startedAt: string; timedCostUsd: number }>
  if (coverageRows.length === 0) return null

  const trackedSince = coverageRows.reduce(
    (earliest, row) => (row.startedAt < earliest ? row.startedAt : earliest),
    coverageRows[0].startedAt
  )
  const undated = coverageRows
    .map((row) => Math.max(0, row.totalCostUsd - row.timedCostUsd))
    .filter((amount) => amount > COST_EPSILON)
  const rows = db
    .prepare(
      `SELECT t.session_id AS sessionId, sm.cwd AS project, t.model,
            t.allocated_at AS allocatedAt, t.est_cost_usd AS costUsd,
            sc.has_unknown_model_cost AS unknownModel
     FROM timed_skill_cost t JOIN session_cost sc ON sc.session_id = t.session_id
     JOIN sessions_meta sm ON sm.session_id = sc.session_id
     WHERE ${PRICED_TERMINAL} AND t.est_cost_usd > 0 AND t.allocated_at >= ? AND t.allocated_at <= ?
     ORDER BY t.allocated_at, t.id`
    )
    .all(new Date(now.getTime() - 30 * DAY_MS).toISOString(), now.toISOString()) as TimedCostRow[]

  const preTrackingSessionCount = (
    db
      .prepare('SELECT COUNT(*) AS count FROM sessions_meta WHERE started_at < ?')
      .get(trackedSince) as { count: number }
  ).count
  const unusableSessionCount = (
    db
      .prepare(
        `SELECT COUNT(*) AS count FROM sessions_meta WHERE started_at >= ?
     AND continued_in_session_id IS NULL
     AND session_id NOT IN (SELECT session_id FROM session_cost WHERE is_zeroed = 0)`
      )
      .get(trackedSince) as { count: number }
  ).count

  return {
    trackedSince,
    totalTrackedCostUsd: coverageRows.reduce((sum, row) => sum + row.totalCostUsd, 0),
    pricedSessionCount: coverageRows.length,
    preTrackingSessionCount,
    unusableSessionCount,
    undatedCostUsd: undated.reduce((sum, amount) => sum + amount, 0),
    undatedSessionCount: undated.length,
    last24h: buildCostWindow(rows, now, 1),
    last7d: buildCostWindow(rows, now, 7),
    last30d: buildCostWindow(rows, now, 30)
  }
}
