import { UNATTRIBUTED_COST_MODEL } from '../../../../shared/ipc'
import { parseModelKey } from '@/lib/model-identity'

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
  if (key === UNATTRIBUTED_COST_MODEL) return 'Unattributed'
  const parsed = parseModelKey(key)
  if (parsed === null) return key
  return `${formatFamilyName(parsed.family)} ${parsed.tail.replace(/-/g, '.')}`
}

export function formatFamilyName(family: string): string {
  return `${family.charAt(0).toUpperCase()}${family.slice(1)}`
}

// The bare version (`5.5`) for a chip sitting inside its family's legend row.
export function formatModelVersion(key: string): string {
  return parseModelKey(key)?.tail.replace(/-/g, '.') ?? formatModelName(key)
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
