import { describe, expect, it } from 'vitest'
import { formatRelativeTime } from './relative-time'

const NOW = new Date('2026-09-03T12:00:00Z')
const SEC = 1000
const MIN = 60 * SEC
const HOUR = 60 * MIN
const DAY = 24 * HOUR
const WEEK = 7 * DAY

const ago = (ms: number): string => new Date(NOW.getTime() - ms).toISOString()

// Compare against Intl's own output rather than a hardcoded English string, so the test verifies
// the bucketing logic (the part we wrote) without being locale-dependent.
const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'always' })
const expected = (value: number, unit: Intl.RelativeTimeFormatUnit): string =>
  rtf.format(value, unit)

describe('formatRelativeTime', () => {
  it('reads "just now" for anything under a minute', () => {
    expect(formatRelativeTime(ago(10 * SEC), NOW)).toBe('just now')
    expect(formatRelativeTime(ago(59 * SEC), NOW)).toBe('just now')
  })

  it('reports whole minutes', () => {
    expect(formatRelativeTime(ago(MIN), NOW)).toBe(expected(-1, 'minute'))
    expect(formatRelativeTime(ago(5 * MIN), NOW)).toBe(expected(-5, 'minute'))
  })

  it('reports hours', () => {
    expect(formatRelativeTime(ago(3 * HOUR), NOW)).toBe(expected(-3, 'hour'))
  })

  it('reports days', () => {
    expect(formatRelativeTime(ago(2 * DAY), NOW)).toBe(expected(-2, 'day'))
  })

  it('rolls over to weeks past 7 days', () => {
    expect(formatRelativeTime(ago(3 * WEEK), NOW)).toBe(expected(-3, 'week'))
  })

  it('handles the bucket boundaries', () => {
    expect(formatRelativeTime(ago(60 * MIN), NOW)).toBe(expected(-1, 'hour'))
    expect(formatRelativeTime(ago(24 * HOUR), NOW)).toBe(expected(-1, 'day'))
    expect(formatRelativeTime(ago(7 * DAY), NOW)).toBe(expected(-1, 'week'))
  })

  it('returns an empty string for an unparseable date', () => {
    expect(formatRelativeTime('not-a-date', NOW)).toBe('')
    expect(formatRelativeTime('', NOW)).toBe('')
  })

  it('defaults `now` to the present', () => {
    expect(formatRelativeTime(new Date().toISOString())).toBe('just now')
  })
})
