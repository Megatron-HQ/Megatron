import { describe, expect, it } from 'vitest'
import { formatUsageSince } from './usage-since'

const now = new Date(2026, 10, 22, 12)

describe('formatUsageSince', () => {
  it('names the month and day within the current year', () => {
    expect(formatUsageSince(new Date(2026, 9, 23, 20).toISOString(), now)).toBe(
      new Date(2026, 9, 23).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    )
  })

  it('adds the year for an earlier year', () => {
    expect(formatUsageSince(new Date(2025, 11, 30).toISOString(), now)).toBe(
      new Date(2025, 11, 30).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      })
    )
  })

  it('has nothing to say without a date or with an unreadable one', () => {
    expect(formatUsageSince(null, now)).toBeNull()
    expect(formatUsageSince('not a date', now)).toBeNull()
  })
})
