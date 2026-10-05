import { UNATTRIBUTED_COST_MODEL } from '../../../shared/ipc'

// Hand-maintained on purpose (docs/usage-view-ui-spec.md §C3.1): a generated hue can't be
// CVD-validated. When Anthropic ships a new version, bump `latest`; a new family takes the next
// slot only after re-running the dataviz palette validator. `latest` is a floor, not a ceiling —
// an observed newer version still wins, so a stale build never paints a new model as "older".
export const MODEL_FAMILIES: Record<string, { slot: 1 | 2 | 3 | 4; latest: string }> = {
  sonnet: { slot: 1, latest: '5-5' },
  opus: { slot: 2, latest: '5-5' },
  haiku: { slot: 3, latest: '4-5' },
  fable: { slot: 4, latest: '5-1' }
}

export interface ParsedModelKey {
  family: string
  tail: string // `5-5`, as written in the key
  version: number[] | null // null when the tail isn't purely numeric — never ranked
}

export interface ModelIdentity {
  family: string | null
  slot: 1 | 2 | 3 | 4 | null
  tintStep: 0 | 1 | 2 // 0 = newest in its family
  newerKey: string | null // the family's newest key, set only when this one is older
}

const OLDER_SHARE_MIN = 0.05
const OLDER_ITEM_MIN = 0.01

// Assumes a normalized key (date suffix stripped at ingest). The legacy `claude-3-5-sonnet` shape
// doesn't match and falls through to the quiet "Other" fold, shown verbatim.
export function parseModelKey(key: string): ParsedModelKey | null {
  const match = /^claude-([a-z]+)-(.+)$/.exec(key)
  if (match === null) return null
  const [, family, tail] = match
  const version = /^\d+(-\d+)*$/.test(tail) ? tail.split('-').map(Number) : null
  return { family, tail, version }
}

function compareVersions(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

// Ranks against the 30d model set (a superset of 7d/24h) plus the bundled latest, so switching
// windows never repaints a survivor.
export function buildModelIdentity(observedKeys: string[]): (key: string) => ModelIdentity {
  const newestByFamily = new Map<string, { key: string; version: number[] }>()
  const versionsByFamily = new Map<string, number[][]>()
  const candidates = [
    ...observedKeys,
    ...Object.entries(MODEL_FAMILIES).map(([family, { latest }]) => `claude-${family}-${latest}`)
  ]
  for (const key of new Set(candidates)) {
    const parsed = parseModelKey(key)
    if (parsed?.version == null) continue
    const versions = versionsByFamily.get(parsed.family) ?? []
    versions.push(parsed.version)
    versionsByFamily.set(parsed.family, versions)
    const newest = newestByFamily.get(parsed.family)
    if (newest === undefined || compareVersions(parsed.version, newest.version) > 0) {
      newestByFamily.set(parsed.family, { key, version: parsed.version })
    }
  }

  return (key) => {
    const parsed = parseModelKey(key)
    if (parsed === null) return { family: null, slot: null, tintStep: 0, newerKey: null }
    const slot = MODEL_FAMILIES[parsed.family]?.slot ?? null
    const { version } = parsed
    if (version === null) return { family: parsed.family, slot, tintStep: 0, newerKey: null }
    const rank = (versionsByFamily.get(parsed.family) ?? []).filter(
      (other) => compareVersions(other, version) > 0
    ).length
    return {
      family: parsed.family,
      slot,
      tintStep: Math.min(rank, 2) as 0 | 1 | 2,
      newerKey: rank > 0 ? (newestByFamily.get(parsed.family)?.key ?? null) : null
    }
  }
}

// Solid tints, not opacity: hover already dims non-focused segments to 40% opacity, and an
// opacity-based tint would read as "dimmed" at rest. Mixed in oklab, not oklch: --background is
// achromatic (hue 0), so an oklch mix rotates the hue — Sonnet blue drifts to violet and reads as
// Fable. oklab only pulls chroma and lightness toward the paper.
const TINT_MIX = { 1: 60, 2: 35 } as const

export function seriesColor(identity: ModelIdentity): string {
  if (identity.slot === null) return 'var(--usage-bar-quiet)'
  const hue = `var(--usage-series-${identity.slot})`
  if (identity.tintStep === 0) return hue
  return `color-mix(in oklab, ${hue} ${TINT_MIX[identity.tintStep]}%, var(--background))`
}

export interface FamilyGroup<T> {
  key: string // the family, or the raw key when it doesn't parse
  total: number
  rows: T[]
}

// Known families by total desc, then unmapped families, then unparseable keys, `unattributed`
// last. Within a family: newest version first, so each block reads full hue → lighter.
export function groupByFamily<T extends { model: string }>(
  rows: T[],
  value: (row: T) => number,
  identify: (key: string) => ModelIdentity
): FamilyGroup<T>[] {
  const groups = new Map<string, FamilyGroup<T>>()
  for (const row of rows) {
    const key = identify(row.model).family ?? row.model
    const group = groups.get(key) ?? { key, total: 0, rows: [] }
    group.total += value(row)
    group.rows.push(row)
    groups.set(key, group)
  }

  const tier = (group: FamilyGroup<T>): number => {
    if (group.key === UNATTRIBUTED_COST_MODEL) return 3
    if (group.key in MODEL_FAMILIES) return 0
    return parseModelKey(group.rows[0].model) === null ? 2 : 1
  }
  for (const group of groups.values()) {
    group.rows.sort((a, b) => {
      const va = parseModelKey(a.model)?.version
      const vb = parseModelKey(b.model)?.version
      if (va && vb) return compareVersions(vb, va)
      if (va || vb) return va ? -1 : 1
      return value(b) - value(a)
    })
  }
  return [...groups.values()].sort((a, b) => tier(a) - tier(b) || b.total - a.total)
}

export interface OlderVersionSummary {
  share: number // 0–1 of the window total, including versions too small to list
  items: { model: string; newerKey: string }[]
}

export function olderVersionSummary(
  byModel: { model: string; costUsd: number }[],
  total: number,
  identify: (key: string) => ModelIdentity
): OlderVersionSummary | null {
  if (total <= 0) return null
  const older = byModel
    .map((entry) => ({ ...entry, newerKey: identify(entry.model).newerKey }))
    .filter((entry) => entry.newerKey !== null && entry.costUsd > 0)
  const share = older.reduce((sum, entry) => sum + entry.costUsd, 0) / total
  if (share < OLDER_SHARE_MIN) return null
  return {
    share,
    items: older
      .filter((entry) => entry.costUsd / total >= OLDER_ITEM_MIN)
      .sort((a, b) => b.costUsd - a.costUsd)
      .map((entry) => ({ model: entry.model, newerKey: entry.newerKey as string }))
  }
}
