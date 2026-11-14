// Synthetic Usage data. The onboarding overview below is its own export, and the Usage view's
// full overview goes beside it, not in its place, so growing that data never moves onboarding.
import type {
  ActivityWindow,
  ModelStatsWindow,
  SkillStatsWindow,
  SkillStatsWindowKey,
  TokenWindow,
  UsageOverview
} from '../../../shared/ipc'
import type { UsageProjectCatalog, UsageProjectLocation } from '../../../shared/usage-projects'
import { WORKSPACES } from './data'

const DAY_MS = 86_400_000

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
