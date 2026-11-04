import type Database from 'better-sqlite3'
import type {
  ContributionDay,
  HistoryCoverage,
  HistoryMonth,
  HistoryProject,
  HistoryYearSummary,
  TokenBreakdown,
  TokenBucket,
  TokenCounts,
  TokenStats,
  TokenWindow,
  UsageCalendar,
  UsageDayDetails
} from '../../shared/ipc'

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
const MONTHS_PER_YEAR = 12
const TOKEN_SELECT =
  'input_tokens AS input, output_tokens AS output, cache_read_tokens AS cacheRead, cache_creation_tokens AS cacheWrite'
type TokenValues = Omit<TokenCounts, 'total'>
interface TokenRow extends TokenValues {
  model: string
  project: string
  allocated_at: string
}
interface CoverageRange {
  start_at: string
  end_at: string
}

function localDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function nextLocalMidnight(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1)
}

function dayBounds(key: string, now: Date): { start: Date; end: Date; next: Date } {
  const start = new Date(`${key}T00:00:00`)
  if (!Number.isFinite(start.getTime()) || localDate(start) !== key)
    throw new Error('Invalid history date')
  const next = nextLocalMidnight(start)
  return { start, next, end: new Date(Math.min(next.getTime(), now.getTime() + 1)) }
}

function sumTokens(rows: TokenValues[]): TokenCounts {
  const counts = rows.reduce(
    (sum, row) => ({
      input: sum.input + row.input,
      output: sum.output + row.output,
      cacheRead: sum.cacheRead + row.cacheRead,
      cacheWrite: sum.cacheWrite + row.cacheWrite
    }),
    { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
  )
  return { ...counts, total: counts.input + counts.output + counts.cacheRead + counts.cacheWrite }
}

function breakdown(rows: TokenRow[], dimension: 'model' | 'project'): TokenBreakdown[] {
  const grouped = new Map<string, TokenRow[]>()
  for (const row of rows) {
    const group = grouped.get(row[dimension]) ?? []
    group.push(row)
    grouped.set(row[dimension], group)
  }
  return [...grouped]
    .map(([key, group]) => ({ key, tokens: sumTokens(group) }))
    .sort((a, b) => b.tokens.total - a.tokens.total || a.key.localeCompare(b.key))
}

function tokenRows(db: Database.Database, start: Date, end: Date): TokenRow[] {
  return db
    .prepare(
      `SELECT model, project, allocated_at, ${TOKEN_SELECT}
    FROM history_token_shares WHERE allocated_at >= ? AND allocated_at < ? ORDER BY allocated_at`
    )
    .all(start.toISOString(), end.toISOString()) as TokenRow[]
}

function tokenWindow(allRows: TokenRow[], start: Date, end: Date, hourly: boolean): TokenWindow {
  const rows = allRows.filter(
    (row) => row.allocated_at >= start.toISOString() && row.allocated_at < end.toISOString()
  )
  const buckets = new Map<string, TokenRow[]>()
  for (const row of rows) {
    const key = hourly
      ? String(Math.min(23, Math.floor((Date.parse(row.allocated_at) - start.getTime()) / HOUR_MS)))
      : localDate(new Date(row.allocated_at))
    const group = buckets.get(key) ?? []
    group.push(row)
    buckets.set(key, group)
  }
  const trend: TokenBucket[] = []
  const cursor = new Date(start)
  if (!hourly) cursor.setHours(0, 0, 0, 0)
  let index = 0
  while (cursor < end && (!hourly || index < 24)) {
    const next = hourly
      ? new Date(index === 23 ? end.getTime() : cursor.getTime() + HOUR_MS)
      : nextLocalMidnight(cursor)
    const key = hourly ? cursor.toISOString() : localDate(cursor)
    const group = buckets.get(hourly ? String(index) : key) ?? []
    trend.push({
      key,
      startAt: new Date(Math.max(cursor.getTime(), start.getTime())).toISOString(),
      endAt: new Date(Math.min(next.getTime(), end.getTime())).toISOString(),
      tokens: group.length > 0 ? sumTokens(group) : null
    })
    cursor.setTime(next.getTime())
    index++
  }
  return {
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    tokens: rows.length > 0 ? sumTokens(rows) : null,
    byModel: breakdown(rows, 'model'),
    byProject: breakdown(rows, 'project'),
    trend
  }
}

export function getTokenStats(db: Database.Database, now: Date = new Date()): TokenStats {
  const end = new Date(now.getTime() + 1)
  const start30d = new Date(now.getTime() - 30 * DAY_MS)
  const rows = tokenRows(db, start30d, end)
  const missing = db
    .prepare(
      `SELECT COUNT(*) AS count FROM history_sessions s
    WHERE continued_in_session_id IS NULL AND (has_totals=0 OR is_zeroed=1
      OR NOT EXISTS (SELECT 1 FROM history_models m WHERE m.session_id=s.session_id))`
    )
    .get() as { count: number }
  return {
    last24h: tokenWindow(rows, new Date(now.getTime() - DAY_MS), end, true),
    last7d: tokenWindow(rows, new Date(now.getTime() - 7 * DAY_MS), end, false),
    last30d: tokenWindow(rows, start30d, end, false),
    missingSessionCount: missing.count,
    undatedTokens: sumTokens(
      db.prepare(`SELECT ${TOKEN_SELECT} FROM history_undated_tokens`).all() as TokenValues[]
    )
  }
}

function historyCoverage(
  start: Date,
  end: Date,
  ranges: CoverageRange[],
  now: Date
): HistoryCoverage {
  if (start > now) return 'future'
  const intersections = ranges.filter(
    (range) => range.end_at > start.toISOString() && range.start_at < end.toISOString()
  )
  if (intersections.length === 0) return 'unavailable'
  let coveredTo = start.toISOString()
  for (const range of intersections) {
    if (range.start_at > coveredTo) return 'partial'
    if (range.end_at > coveredTo) coveredTo = range.end_at
  }
  return coveredTo >= end.toISOString() ? 'available' : 'partial'
}

function summarizeHistory(days: ContributionDay[]): HistoryYearSummary {
  let longestStreak: HistoryYearSummary['longestStreak'] = null
  let busiestDay: HistoryYearSummary['busiestDay'] = null
  let streakDays = 0
  let streakStart = ''
  for (const day of days) {
    if (day.count > (busiestDay?.count ?? 0)) busiestDay = { date: day.date, count: day.count }
    if (day.count === 0 || day.coverage === 'unavailable' || day.coverage === 'future') {
      streakDays = 0
      continue
    }
    if (streakDays === 0) streakStart = day.date
    streakDays++
    if (streakDays > (longestStreak?.days ?? 0)) {
      longestStreak = { days: streakDays, startDate: streakStart, endDate: day.date }
    }
  }
  const activeDays = days.filter((day) => day.count > 0)
  return {
    observedDays: days.filter((day) => day.coverage === 'available' || day.coverage === 'partial')
      .length,
    partialDays: days.filter((day) => day.coverage === 'partial').length,
    elapsedDays: days.filter((day) => day.coverage !== 'future').length,
    longestStreak,
    busiestDay,
    promptsPerActiveDay:
      activeDays.length > 0
        ? activeDays.reduce((sum, day) => sum + day.count, 0) / activeDays.length
        : null
  }
}

function historyMonths(days: ContributionDay[]): HistoryMonth[] {
  return Array.from({ length: MONTHS_PER_YEAR }, (_, index) => {
    const monthDays = days.filter((day) => Number(day.date.slice(5, 7)) === index + 1)
    const elapsed = monthDays.filter((day) => day.coverage !== 'future')
    const coverage =
      elapsed.length === 0
        ? 'future'
        : elapsed.every((day) => day.coverage === 'unavailable')
          ? 'unavailable'
          : elapsed.every((day) => day.coverage === 'available')
            ? 'available'
            : 'partial'
    return { month: index + 1, count: monthDays.reduce((sum, day) => sum + day.count, 0), coverage }
  })
}

function historyProjects(db: Database.Database, start: Date, end: Date): HistoryProject[] {
  const rows = db
    .prepare(
      `SELECT project, CAST(strftime('%m',typed_at,'localtime') AS INTEGER) AS month,
      SUM(copies) AS count FROM history_prompts
      WHERE typed_at >= ? AND typed_at < ? AND is_slash_command=0
      GROUP BY project, month`
    )
    .all(start.toISOString(), end.toISOString()) as Array<{
    project: string
    month: number
    count: number
  }>
  const projects = new Map<string, HistoryProject>()
  for (const row of rows) {
    const project = projects.get(row.project) ?? {
      project: row.project,
      total: 0,
      byMonth: Array<number>(MONTHS_PER_YEAR).fill(0)
    }
    project.byMonth[row.month - 1] = row.count
    project.total += row.count
    projects.set(row.project, project)
  }
  return [...projects.values()].sort(
    (a, b) => b.total - a.total || a.project.localeCompare(b.project)
  )
}

export function getUsageCalendar(
  db: Database.Database,
  year: number,
  now: Date = new Date()
): UsageCalendar {
  if (!Number.isInteger(year) || year < 1970 || year > 9999) throw new Error('Invalid history year')
  const start = new Date(year, 0, 1)
  const end = new Date(year + 1, 0, 1)
  const asOf = new Date(Math.min(end.getTime(), now.getTime() + 1))
  const prompts = db
    .prepare(
      `SELECT strftime('%Y-%m-%d',typed_at,'localtime') AS date,
      SUM(CASE WHEN is_slash_command=0 THEN copies ELSE 0 END) AS count FROM history_prompts
      WHERE typed_at >= ? AND typed_at < ? GROUP BY date`
    )
    .all(start.toISOString(), asOf.toISOString()) as Array<{ date: string; count: number }>
  const byDate = new Map(prompts.map((day) => [day.date, day.count]))
  const tokensByDate = new Map<string, TokenRow[]>()
  for (const row of tokenRows(db, start, asOf)) {
    const key = localDate(new Date(row.allocated_at))
    const rows = tokensByDate.get(key) ?? []
    rows.push(row)
    tokensByDate.set(key, rows)
  }
  const ranges = db
    .prepare('SELECT * FROM history_coverage ORDER BY start_at')
    .all() as CoverageRange[]
  const days: ContributionDay[] = []
  const cursor = new Date(start)
  while (cursor < end) {
    const date = localDate(cursor)
    const bounds = dayBounds(date, now)
    const dayTokens = tokensByDate.get(date) ?? []
    days.push({
      date,
      weekday: cursor.getDay(),
      count: byDate.get(date) ?? 0,
      coverage: historyCoverage(bounds.start, bounds.end, ranges, now),
      tokens: dayTokens.length > 0 ? sumTokens(dayTokens) : null
    })
    cursor.setDate(cursor.getDate() + 1)
  }
  const recordedYears = db
    .prepare(
      `SELECT DISTINCT strftime('%Y', stamp, 'localtime') AS year FROM
      (SELECT typed_at AS stamp FROM history_prompts UNION SELECT allocated_at AS stamp FROM history_token_shares)
      WHERE stamp <= ?`
    )
    .all(now.toISOString()) as Array<{ year: string }>
  const years = [...new Set([now.getFullYear(), ...recordedYears.map((row) => Number(row.year))])]
    .filter((value) => value >= 1970 && value <= now.getFullYear())
    .sort((a, b) => b - a)
  const counts = db
    .prepare(
      `SELECT SUM(copies) AS count FROM history_prompts
      WHERE is_slash_command=0 AND typed_at <= ? GROUP BY strftime('%Y-%m-%d',typed_at,'localtime') ORDER BY count`
    )
    .all(now.toISOString()) as Array<{ count: number }>
  const thresholds = [0.25, 0.5, 0.75].map(
    (fraction) => counts[Math.max(0, Math.ceil(counts.length * fraction) - 1)]?.count ?? 1
  )
  return {
    year,
    years,
    days,
    thresholds,
    prompts: days.reduce((sum, day) => sum + day.count, 0),
    activeDays: days.filter((day) => day.count > 0).length,
    summary: summarizeHistory(days),
    months: historyMonths(days),
    byProject: historyProjects(db, start, asOf)
  }
}

export function getUsageDay(
  db: Database.Database,
  date: string,
  now: Date = new Date()
): UsageDayDetails {
  const { start, end, next } = dayBounds(date, now)
  if (start > now) throw new Error('Future dates have no usage details')
  const summary = db
    .prepare(
      `SELECT
    COALESCE(SUM(CASE WHEN is_slash_command=0 THEN copies ELSE 0 END),0) AS count,
    COUNT(DISTINCT CASE WHEN is_slash_command=0 THEN session_id END) AS sessions,
    COALESCE(SUM(CASE WHEN is_slash_command=1 THEN copies ELSE 0 END),0) AS slashCommands
    FROM history_prompts WHERE typed_at >= ? AND typed_at < ?`
    )
    .get(start.toISOString(), end.toISOString()) as {
    count: number
    sessions: number
    slashCommands: number
  }
  const byProject = db
    .prepare(
      `SELECT project,SUM(copies) AS count FROM history_prompts
    WHERE typed_at >= ? AND typed_at < ? AND is_slash_command=0 GROUP BY project ORDER BY count DESC, project`
    )
    .all(start.toISOString(), end.toISOString()) as Array<{ project: string; count: number }>
  const ranges = db
    .prepare('SELECT * FROM history_coverage ORDER BY start_at')
    .all() as CoverageRange[]
  const rows = tokenRows(db, start, end)
  return {
    date,
    weekday: start.getDay(),
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    partial: next > now,
    ...summary,
    byProject,
    coverage: historyCoverage(start, end, ranges, now),
    tokens: rows.length > 0 ? sumTokens(rows) : null
  }
}
