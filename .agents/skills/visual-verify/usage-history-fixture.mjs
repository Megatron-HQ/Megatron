const DAY_MS = 86400000
const HISTORY_PROJECT_NAMES = [
  'Megatron',
  'Client\\Atlas',
  'Website',
  'Data pipeline',
  'Research',
  'CLI',
  'Docs',
  'Sandbox',
  'Orchard',
  'Internal\\Atlas'
]

// Claude app chats (folderless Claude desktop chats): twelve, so the folded group's own list
// overflows its show-more. One title holds a `/`; one has no title and only an archived start
// date, the label a chat falls back to once its transcript is pruned.
const CHATS = Array.from({ length: 12 }, (_, index) => ({
  path: `C:\\Users\\Visual\\AppData\\Roaming\\Claude\\scratch-workspaces\\ws\\acct\\scratch-2026-10-${String(index + 10)}-a${index.toString(16)}0f58`,
  chat:
    index === 1
      ? { title: 'Fix the CI/CD flake', startedAt: '2026-10-11T15:00:00.000Z' }
      : index === 2
        ? { title: null, startedAt: '2026-10-12T09:30:00.000Z' }
        : {
            title: `Plan launch email ${index + 1}`,
            startedAt: `2026-10-${index + 10}T12:00:00.000Z`
          }
}))

function counts(multiplier = 1) {
  return {
    input: 12000 * multiplier,
    output: 45000 * multiplier,
    cacheRead: 730000 * multiplier,
    cacheWrite: 125000 * multiplier,
    total: 912000 * multiplier
  }
}

function tokenWindow(days, empty) {
  const now = new Date()
  const start = new Date(now.getTime() - days * DAY_MS)
  const trend = Array.from({ length: days === 1 ? 24 : days }, (_, index) => {
    const startAt = new Date(start.getTime() + index * (days === 1 ? 3600000 : DAY_MS))
    const endAt = new Date(startAt.getTime() + (days === 1 ? 3600000 : DAY_MS))
    return {
      key: days === 1 ? startAt.toISOString() : localDate(startAt),
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      tokens: empty ? null : counts((index % 5) + 1)
    }
  })
  const tokens = empty
    ? null
    : trend.reduce(
        (sum, bucket) =>
          Object.fromEntries(Object.keys(sum).map((key) => [key, sum[key] + bucket.tokens[key]])),
        { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
      )
  return {
    startAt: start.toISOString(),
    endAt: now.toISOString(),
    tokens,
    trend,
    byModel: empty ? [] : [{ key: 'claude-sonnet-5', tokens }],
    byProject: empty ? [] : [{ key: 'C:\\Projects\\Megatron', tokens }]
  }
}

function localDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function formatWindow(days) {
  const window = tokenWindow(days, true)
  const tokens = {
    input: 1250,
    output: 1250000,
    cacheRead: 2500000000,
    cacheWrite: 0,
    total: 2501251250
  }
  const projectTokens = {
    input: 125,
    output: 125000,
    cacheRead: 250000000,
    cacheWrite: 0,
    total: 250125125
  }
  return {
    ...window,
    tokens,
    trend: window.trend.map((bucket, index) => ({
      ...bucket,
      tokens: index === window.trend.length - 1 ? tokens : null
    })),
    byModel: [{ key: 'claude-sonnet-5', tokens }],
    byProject: Array.from({ length: 10 }, (_, index) => ({
      key: `C:\\Projects\\repo-${index + 1}`,
      tokens: projectTokens
    }))
  }
}

export function usageHistoryFixture(channel, args, original, mode) {
  const now = new Date()
  if (channel === 'usage:projects') {
    const names = [
      ...HISTORY_PROJECT_NAMES,
      ...Array.from({ length: 10 }, (_, index) => `repo-${index + 1}`)
    ]
    const locations = names.map((name, index) => ({
      id: `visual-project:${index}`,
      path: `C:\\Projects\\${name}`,
      kind: 'repository',
      status: 'available'
    }))
    const chats = mode === 'usage-history-chats' ? CHATS : []
    const chatLocations = chats.map((entry, index) => ({
      id: `visual-chat:${index}`,
      path: entry.path,
      kind: 'folder',
      status: 'needs_access'
    }))
    return {
      locations: [...locations, ...chatLocations],
      projects: [
        ...locations.map((location, index) => ({
          id: location.id,
          path: location.path,
          label: names[index].replace(/\\/g, '/'),
          locations: [location],
          possibleMatches: []
        })),
        ...chatLocations.map((location, index) => ({
          id: location.id,
          path: location.path,
          label: location.path.split('\\').pop(),
          locations: [location],
          possibleMatches: [],
          chat: chats[index].chat
        }))
      ]
    }
  }
  if (channel === 'usage:overview' && mode === 'usage-history-format') {
    return {
      ...original,
      tokens: {
        last24h: formatWindow(1),
        last7d: formatWindow(7),
        last30d: formatWindow(30),
        missingSessionCount: 0,
        undatedTokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
      }
    }
  }
  if (channel === 'usage:overview' && mode === 'usage-history-chats') {
    const window = (days) => ({
      ...tokenWindow(days, false),
      byProject: [
        { key: 'C:\\Projects\\Megatron', tokens: counts(100) },
        ...CHATS.map((entry, index) => ({ key: entry.path, tokens: counts(12 - index) })),
        { key: 'C:\\Projects\\Website', tokens: counts(30) }
      ].sort((a, b) => b.tokens.total - a.tokens.total)
    })
    return {
      ...original,
      tokens: {
        last24h: window(1),
        last7d: window(7),
        last30d: window(30),
        missingSessionCount: 0,
        undatedTokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
      }
    }
  }
  if (channel === 'usage:overview')
    return {
      ...original,
      tokens: {
        last24h: tokenWindow(1, mode === 'usage-history-empty'),
        last7d: tokenWindow(7, mode === 'usage-history-empty'),
        last30d: tokenWindow(30, mode === 'usage-history-empty'),
        missingSessionCount: 2,
        undatedTokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
      }
    }
  if (channel === 'usage:calendar') {
    const year = args[0]
    const cursor = new Date(year, 0, 1)
    const days = []
    while (cursor.getFullYear() === year) {
      const date = localDate(cursor)
      const available = cursor.getMonth() >= 1 && mode !== 'usage-history-unavailable'
      const tokenOnly =
        mode === 'usage-history-token-only' && cursor.getMonth() === 0 && cursor.getDate() === 1
      const count =
        available && cursor <= now && mode !== 'usage-history-empty'
          ? (cursor.getDate() * 7 + cursor.getMonth() * 3) % 41
          : 0
      days.push({
        date,
        weekday: cursor.getDay(),
        count,
        coverage:
          cursor > now
            ? 'future'
            : !available
              ? 'unavailable'
              : date === localDate(now)
                ? 'partial'
                : 'available',
        tokens: tokenOnly ? counts() : count > 0 ? counts(count) : null
      })
      cursor.setDate(cursor.getDate() + 1)
    }
    const months = Array.from({ length: 12 }, (_, index) => {
      const elapsed = days.filter(
        (day) => Number(day.date.slice(5, 7)) === index + 1 && day.coverage !== 'future'
      )
      return {
        month: index + 1,
        count: elapsed.reduce((sum, day) => sum + day.count, 0),
        coverage:
          elapsed.length === 0
            ? 'future'
            : elapsed.every((day) => day.coverage === 'unavailable')
              ? 'unavailable'
              : elapsed.every((day) => day.coverage === 'available')
                ? 'available'
                : 'partial'
      }
    })
    const projectNames = HISTORY_PROJECT_NAMES
    const byProject = projectNames
      .map((name, index) => {
        const byMonth = months.map((month) => {
          const weights = projectNames.map(
            (_, rank) => (10 - rank) * (month.month > 6 && rank % 2 === 1 ? 3 : 1)
          )
          const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)
          const previous = weights.slice(0, index).reduce((sum, weight) => sum + weight, 0)
          return (
            Math.floor((month.count * (previous + weights[index])) / totalWeight) -
            Math.floor((month.count * previous) / totalWeight)
          )
        })
        return {
          project: `C:\\Projects\\${name}`,
          total: byMonth.reduce((sum, count) => sum + count, 0),
          byMonth
        }
      })
      .concat(
        mode === 'usage-history-chats'
          ? CHATS.map((entry, index) => {
              const byMonth = months.map((month) =>
                month.month >= 10 && month.coverage !== 'future' ? 12 - index : 0
              )
              return {
                project: entry.path,
                total: byMonth.reduce((sum, count) => sum + count, 0),
                byMonth
              }
            })
          : []
      )
      .filter((project) => project.total > 0)
      .sort((a, b) => b.total - a.total)
    let longestStreak = null
    let busiestDay = null
    let run = []
    for (const day of days) {
      if (day.count > (busiestDay?.count ?? 0)) busiestDay = { date: day.date, count: day.count }
      run = day.count > 0 ? [...run, day] : []
      if (run.length > (longestStreak?.days ?? 0)) {
        longestStreak = { days: run.length, startDate: run[0].date, endDate: day.date }
      }
    }
    const prompts = days.reduce((sum, day) => sum + day.count, 0)
    const activeDays = days.filter((day) => day.count > 0).length
    return {
      year,
      years: [now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2],
      days,
      thresholds: [10, 20, 30],
      prompts,
      activeDays,
      summary: {
        observedDays: days.filter(
          (day) => day.coverage === 'available' || day.coverage === 'partial'
        ).length,
        partialDays: days.filter((day) => day.coverage === 'partial').length,
        elapsedDays: days.filter((day) => day.coverage !== 'future').length,
        longestStreak,
        busiestDay,
        promptsPerActiveDay: activeDays > 0 ? prompts / activeDays : null
      },
      months,
      byProject
    }
  }
  if (channel === 'usage:day') {
    const date = args[0]
    const start = new Date(`${date}T00:00:00`)
    const tokenOnly =
      mode === 'usage-history-token-only' && start.getMonth() === 0 && start.getDate() === 1
    const count = tokenOnly ? 0 : (start.getDate() * 7 + start.getMonth() * 3) % 41
    const end = new Date(start)
    end.setDate(end.getDate() + 1)
    return {
      date,
      weekday: start.getDay(),
      startAt: start.toISOString(),
      endAt: end.toISOString(),
      partial: false,
      count,
      sessions: tokenOnly ? 0 : 3,
      slashCommands: tokenOnly ? 0 : 2,
      byProject: tokenOnly ? [] : [{ project: 'C:\\Projects\\Megatron', count }],
      tokens: tokenOnly ? counts() : count > 0 ? counts(count) : null,
      coverage: tokenOnly ? 'unavailable' : 'available'
    }
  }
  return original
}
