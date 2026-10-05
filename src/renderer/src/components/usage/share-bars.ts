// Relative, not `@/`: vitest has no path alias, and this module is unit-tested.
import { groupByFamily, type FamilyGroup, type ModelIdentity } from '../../lib/model-identity'

export interface ShareSeries<T> {
  label?: string // gutter label; omit on every series for a gutterless bar (Cost)
  value: (row: T) => number
  total: number // the share denominator, e.g. CostStats.totalCostUsd
}

export interface ShareSegment<T> {
  row: T
  family: string
  fraction: number // of the bar's width
  order: number // enter-stagger index, continuing across bars
}

export interface ShareBarsLayout<T> {
  groups: FamilyGroup<T>[]
  bars: { label?: string; segments: ShareSegment<T>[] }[]
  // Per series, summed over a family's rows or one version's: the raw value and its share label.
  measure: (rows: T[]) => { values: number[]; shares: string[] }
}

export function percentLabel(value: number, total: number): string {
  if (total <= 0 || value <= 0) return '0%'
  const pct = (value / total) * 100
  return pct < 1 ? '<1%' : `${Math.round(pct)}%`
}

// The first series fixes the order for every bar, so a model holds the same position in each and
// a change in width is the only thing that moves.
export function buildShareBars<T extends { model: string }>(
  rows: T[],
  series: ShareSeries<T>[],
  identify: (key: string) => ModelIdentity
): ShareBarsLayout<T> {
  const groups = groupByFamily(rows, series[0].value, identify)
  const ordered = groups.flatMap((group) => group.rows.map((row) => ({ row, family: group.key })))
  let order = 0
  const bars = series.map((entry) => {
    // Widths are relative to the stated total so an undercount (Cost's `hasUnknownModelCost`)
    // shows as real trailing slack, never overflow.
    const sum = ordered.reduce((acc, { row }) => acc + entry.value(row), 0)
    const denom = Math.max(entry.total, sum) || 1
    const segments = ordered
      .filter(({ row }) => entry.value(row) > 0)
      .map(({ row, family }) => ({
        row,
        family,
        fraction: entry.value(row) / denom,
        order: order++
      }))
    return { label: entry.label, segments }
  })
  const measure = (subset: T[]): { values: number[]; shares: string[] } => {
    const values = series.map((entry) => subset.reduce((acc, row) => acc + entry.value(row), 0))
    return { values, shares: values.map((value, i) => percentLabel(value, series[i].total)) }
  }
  return { groups, bars, measure }
}
