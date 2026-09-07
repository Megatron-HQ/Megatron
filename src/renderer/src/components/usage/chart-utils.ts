// Row 0 of every histogram is Sunday (matches the ActivityWindow contract). The punchcard shows
// Mon-first, so it reorders via WEEKDAY_DISPLAY_ORDER.
export const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const WEEKDAY_DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0]
export const WEEKDAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']

export function formatCount(n: number): string {
  return n.toLocaleString()
}

// Whole dollars on the hero numeral — cents are false precision on a figure known to run ~16%
// high vs a real invoice (docs/usage-analytics.md). `<$1` when a non-zero total rounds to zero,
// so it never reads as `$0` (broken). `cents: true` in the legend / RankedList, where magnitudes
// are compared side by side.
export function formatUsd(n: number, { cents }: { cents: boolean }): string {
  if (cents) return `$${n.toFixed(2)}`
  if (n > 0 && n < 0.5) return '<$1'
  return `$${Math.round(n).toLocaleString()}`
}

// `claude-sonnet-5` → `Sonnet 5`, `claude-haiku-4-5` → `Haiku 4.5`. Family title-cased, version
// tail as-is with `-` → `.`. An unrecognized key returns verbatim — never hidden (§C2.4).
export function formatModelName(key: string): string {
  const match = /^claude-([a-z]+)-(.+)$/.exec(key)
  if (match === null) return key
  const [, family, tail] = match
  return `${family.charAt(0).toUpperCase()}${family.slice(1)} ${tail.replace(/-/g, '.')}`
}

// Fixed assignment by model *family*, never by rank — a filter that changes which models appear
// must not repaint the survivors. Tokens are named by slot so "Sonnet 6" inherits slot 1.
export const MODEL_SERIES: Record<string, 1 | 2 | 3> = {
  sonnet: 1,
  opus: 2,
  haiku: 3
}

// The CSS var for a model's data-series hue, or `--usage-bar-quiet` (neutral, the "Other" fold)
// for an unmapped family. Assumes a normalized key (date suffix already stripped at ingest).
export function modelSeriesVar(model: string): string {
  const family = /^claude-([a-z]+)-/.exec(model)?.[1]
  const slot = family === undefined ? undefined : MODEL_SERIES[family]
  return slot === undefined ? 'var(--usage-bar-quiet)' : `var(--usage-series-${slot})`
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
