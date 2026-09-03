// Native Intl.RelativeTimeFormat — no dependency. Coarse buckets (just now / minutes / hours /
// days / weeks) are all the recent-activity list needs; the exact timestamp lives in the row's
// `title`. `numeric: 'always'` keeps output predictable ("1 day ago", never "yesterday").
const DIVISIONS: { amount: number; unit: Intl.RelativeTimeFormatUnit }[] = [
  { amount: 60, unit: 'minute' },
  { amount: 24, unit: 'hour' },
  { amount: 7, unit: 'day' },
  { amount: Number.POSITIVE_INFINITY, unit: 'week' }
]

export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return ''

  let value = (then.getTime() - now.getTime()) / 60_000 // minutes, negative in the past
  if (Math.abs(value) < 1) return 'just now'

  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'always' })
  for (const { amount, unit } of DIVISIONS) {
    if (Math.abs(value) < amount) return rtf.format(Math.round(value), unit)
    value /= amount
  }
  return 'just now' // unreachable — the final division catches everything
}
