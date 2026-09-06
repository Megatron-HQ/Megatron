// Row 0 of every histogram is Sunday (matches the ActivityWindow contract). The punchcard shows
// Mon-first, so it reorders via WEEKDAY_DISPLAY_ORDER.
export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const WEEKDAY_DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0]
export const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

export function formatCount(n: number): string {
  return n.toLocaleString()
}

// Quantile-bucketed opacity for the punchcard: empty + 4 levels of --usage-bar at 15/40/65/90%
// (docs/usage-view-ui-spec.md §4.1). Quantile, not linear, so the two peaks don't wash the rest
// out. Returns a function mapping a cell value to its opacity.
export function quantileOpacity(values: number[]): (value: number) => number {
  const positives = values.filter((v) => v > 0).sort((a, b) => a - b)
  if (positives.length === 0) return () => 0

  const LEVELS = [0.15, 0.4, 0.65, 0.9]
  // Three interior quantile cut points split the positive values into 4 buckets.
  const cuts = [0.25, 0.5, 0.75].map(
    (q) => positives[Math.min(positives.length - 1, Math.floor(q * positives.length))]
  )
  return (value: number) => {
    if (value <= 0) return 0
    let bucket = 0
    while (bucket < cuts.length && value > cuts[bucket]) bucket++
    return LEVELS[bucket]
  }
}
