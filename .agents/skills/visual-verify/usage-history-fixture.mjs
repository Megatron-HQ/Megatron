const DAY_MS = 86400000

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

export function usageHistoryFixture(channel, args, original, mode) {
  const now = new Date()
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
      const available = cursor.getMonth() >= 1
      const tokenOnly =
        mode === 'usage-history-token-only' && cursor.getMonth() === 0 && cursor.getDate() === 1
      const count =
        available && cursor <= now ? (cursor.getDate() * 7 + cursor.getMonth() * 3) % 41 : 0
      days.push({
        date,
        weekday: cursor.getDay(),
        count,
        coverage: cursor > now ? 'future' : available ? 'available' : 'unavailable',
        tokens: tokenOnly ? counts() : count > 0 ? counts(count) : null
      })
      cursor.setDate(cursor.getDate() + 1)
    }
    return {
      year,
      years: [now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2],
      days,
      thresholds: [10, 20, 30],
      prompts: days.reduce((sum, day) => sum + day.count, 0),
      activeDays: days.filter((day) => day.count > 0).length
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
