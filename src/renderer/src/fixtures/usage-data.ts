// Synthetic Usage data. The onboarding overview below is its own export, and the Usage view's
// full overview goes beside it, not in its place, so growing that data never moves onboarding.
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
import type { UsageProjectCatalog, UsageProjectLocation } from '../../../shared/usage-projects'
import { WORKSPACES } from './data'

const DAY_MS = 86_400_000
const PROJECTS = ['/Users/fixture/Work/Megatron', '/Users/fixture/Work/Internal']

function dateKey(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}

function tokenCounts(total = 0): TokenCounts {
  return { input: total, output: 0, cacheRead: 0, cacheWrite: 0, total }
}

function span(days: number): { startAt: string; endAt: string } {
  return {
    startAt: new Date(Date.now() - days * DAY_MS).toISOString(),
    endAt: new Date(Date.now()).toISOString()
  }
}

const zeros = (length: number): number[] => Array.from({ length }, () => 0)

function activity(
  days: ActivityWindow['days'],
  prompts = 0,
  sessions = 0,
  activeDays = 0
): ActivityWindow {
  return {
    days,
    activeDays,
    sessions,
    prompts,
    slashCommands: 0,
    byHour: zeros(24),
    byWeekday: zeros(7),
    byHourWeekday: Array.from({ length: 7 }, () => zeros(24)),
    byProject: [],
    byDay: []
  }
}

function tokens(days: number): TokenWindow {
  return { ...span(days), tokens: null, byModel: [], byProject: [], trend: [] }
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

function skills(window: SkillStatsWindowKey, days: number): SkillStatsWindow {
  return {
    window,
    ...span(days),
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

// What onboarding's Usage card reads: a finished scan and the prompts of the last 30 days.
// Every other window is empty.
export const onboardingOverview = {
  tokens: {
    last24h: tokens(1),
    last7d: tokens(7),
    last30d: tokens(30),
    missingSessionCount: 0,
    undatedTokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
  },
  activity: {
    last24h: { ...activity(1), days: 1, hourlyTrend: [] },
    last7d: activity(7),
    last30d: activity(30, 1_284, 96, 22),
    generatedAt: new Date(Date.now()).toISOString()
  },
  cost: null,
  models: { last24h: models('24h'), last7d: models('7d'), last30d: models('30d') },
  skills: {
    last24h: skills('24h', 1),
    last7d: skills('7d', 7),
    last30d: skills('30d', 30),
    pricedSessionsWithoutSkill: 0
  },
  scanComplete: true
} satisfies UsageOverview

// One project per folder Claude Code ran in, each a repository at its own path.
export const usageProjects: UsageProjectCatalog = (() => {
  const locations = WORKSPACES.map((path): UsageProjectLocation => ({
    id: path,
    path,
    kind: 'repository',
    status: 'available'
  }))
  return {
    locations,
    projects: locations.map((location) => ({
      id: location.id,
      path: location.path,
      label: location.path.slice(location.path.lastIndexOf('/') + 1),
      locations: [location],
      possibleMatches: []
    }))
  }
})()

export function usageOverview(): UsageOverview {
  return {
    scanComplete: true,
    activity: {
      last24h: { ...activity(1), days: 1, hourlyTrend: [] },
      last7d: activity(7),
      last30d: activity(30),
      generatedAt: new Date(Date.now()).toISOString()
    },
    tokens: {
      last24h: tokens(30),
      last7d: tokens(30),
      last30d: tokens(30),
      missingSessionCount: 0,
      undatedTokens: tokenCounts()
    },
    cost: null,
    models: { last24h: models('24h'), last7d: models('7d'), last30d: models('30d') },
    skills: {
      last24h: skills('24h', 30),
      last7d: skills('7d', 30),
      last30d: skills('30d', 30),
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
