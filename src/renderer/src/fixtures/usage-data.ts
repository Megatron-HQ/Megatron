import type { Api } from '../../../shared/api'
import type {
  ActivityWindow,
  ModelStatsWindow,
  SkillStatsWindow,
  SkillStatsWindowKey,
  TokenCounts,
  TokenWindow,
  UsageCalendar,
  UsageDayDetails,
  UsageOverview
} from '../../../shared/ipc'
import { daysAgo } from './data'

const DAY_MS = 86_400_000
const PROJECTS = ['/Users/fixture/Work/Megatron', '/Users/fixture/Work/Internal']

function dateKey(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}

function tokenCounts(total = 0): TokenCounts {
  return { input: total, output: 0, cacheRead: 0, cacheWrite: 0, total }
}

function activity(days: 1 | 7 | 30): ActivityWindow {
  return {
    days,
    activeDays: 0,
    sessions: 0,
    prompts: 0,
    slashCommands: 0,
    byHour: Array(24).fill(0),
    byWeekday: Array(7).fill(0),
    byHourWeekday: Array.from({ length: 7 }, () => Array(24).fill(0)),
    byProject: [],
    byDay: []
  }
}

function tokens(): TokenWindow {
  return {
    startAt: daysAgo(30),
    endAt: daysAgo(0),
    tokens: null,
    byModel: [],
    byProject: [],
    trend: []
  }
}

function models(window: SkillStatsWindowKey): ModelStatsWindow {
  return {
    window,
    turnCount: 0,
    modelCount: 0,
    outputTokens: 0,
    byModel: [],
    byEffort: [],
    matrix: []
  }
}

function skills(window: SkillStatsWindowKey): SkillStatsWindow {
  return {
    window,
    startAt: daysAgo(30),
    endAt: daysAgo(0),
    invocationCount: 0,
    unpricedInvocationCount: 0,
    skillCount: 0,
    sessionCount: 0,
    bySkill: [],
    byTriggerType: [],
    trend: [],
    associations: [],
    attribution: {
      totalEstimatedCostCents: 0,
      trackedSessionCount: 0,
      hasUnknownModelCost: false,
      hasUndatedCost: false,
      rows: []
    }
  }
}

export function usageOverview(): UsageOverview {
  return {
    scanComplete: true,
    activity: {
      last24h: { ...activity(1), days: 1, hourlyTrend: [] },
      last7d: activity(7),
      last30d: activity(30),
      generatedAt: daysAgo(0)
    },
    tokens: {
      last24h: tokens(),
      last7d: tokens(),
      last30d: tokens(),
      missingSessionCount: 0,
      undatedTokens: tokenCounts()
    },
    cost: null,
    models: { last24h: models('24h'), last7d: models('7d'), last30d: models('30d') },
    skills: {
      last24h: skills('24h'),
      last7d: skills('7d'),
      last30d: skills('30d'),
      pricedSessionsWithoutSkill: 0
    }
  }
}

export function usageCalendar(year = new Date().getFullYear()): UsageCalendar {
  const today = dateKey(new Date())
  const days = [] as UsageCalendar['days']
  for (
    let day = new Date(year, 0, 1);
    day.getFullYear() === year;
    day = new Date(day.getTime() + DAY_MS)
  ) {
    const date = dateKey(day)
    const future = date > today
    const count = future ? 0 : (day.getDate() % 4) + 1
    days.push({
      date,
      weekday: day.getDay(),
      count,
      coverage: future ? 'future' : 'available',
      tokens: future ? null : tokenCounts(count * 1200)
    })
  }
  const observed = days.filter((day) => day.coverage !== 'future')
  const prompts = observed.reduce((sum, day) => sum + day.count, 0)
  const busiest = observed.find((day) => day.count === 4)
  const months = Array.from({ length: 12 }, (_, month) => {
    const entries = days.filter((day) => Number(day.date.slice(5, 7)) === month + 1)
    return {
      month: month + 1,
      count: entries.reduce((sum, day) => sum + day.count, 0),
      coverage: entries.every((day) => day.coverage === 'future')
        ? ('future' as const)
        : ('available' as const)
    }
  })
  return {
    year,
    years: [new Date().getFullYear(), new Date().getFullYear() - 1],
    days,
    thresholds: [1, 2, 3],
    prompts,
    activeDays: observed.length,
    summary: {
      observedDays: observed.length,
      partialDays: 0,
      elapsedDays: observed.length,
      longestStreak: observed.length
        ? { days: observed.length, startDate: observed[0].date, endDate: observed.at(-1)!.date }
        : null,
      busiestDay: busiest ? { date: busiest.date, count: busiest.count } : null,
      promptsPerActiveDay: observed.length ? prompts / observed.length : null
    },
    months,
    byProject: PROJECTS.map((project, index) => {
      const byMonth = months.map((month) =>
        index === 0 ? Math.ceil(month.count / 2) : Math.floor(month.count / 2)
      )
      return { project, total: byMonth.reduce((sum, count) => sum + count, 0), byMonth }
    })
  }
}

export function usageDay(date: string): UsageDayDetails {
  const start = new Date(`${date}T00:00:00`)
  const count = (start.getDate() % 4) + 1
  return {
    date,
    weekday: start.getDay(),
    partial: false,
    coverage: 'available',
    startAt: start.toISOString(),
    endAt: new Date(start.getTime() + DAY_MS).toISOString(),
    count,
    sessions: Math.min(count, 2),
    slashCommands: 0,
    byProject: [{ project: PROJECTS[0], count }],
    tokens: tokenCounts(count * 1200)
  }
}

export function historyApi(): Partial<Api> {
  return {
    getUsageOverview: async () => usageOverview(),
    getUsageCalendar: async (year) => usageCalendar(year),
    getUsageDay: async (date) => usageDay(date),
    getUsageProjects: async () => ({ locations: [], projects: [] })
  }
}
