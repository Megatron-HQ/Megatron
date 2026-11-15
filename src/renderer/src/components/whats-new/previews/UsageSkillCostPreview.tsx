import { useQuery } from '@tanstack/react-query'
import type { SkillCostAttributionRow } from '../../../../../shared/ipc'
import { formatUsd } from '@/components/usage/chart-utils'
import { getSkillDisplayName } from '@/lib/source-name'
import { usageOverviewQuery } from '@/lib/usage-overview-query'
import { PreviewSkeleton, SampleLabel } from './PreviewChrome'

const PREVIEW_ROWS = 3

interface PreviewRow {
  label: string
  share: number
  costCents: number
}

// Shown when this user has no attributed skill cost yet, so the preview never renders empty.
const SAMPLE_ROWS: PreviewRow[] = [
  { label: 'code-review', share: 0.42, costCents: 1840 },
  { label: 'test-driven-development', share: 0.27, costCents: 1185 },
  { label: 'visual-verify', share: 0.13, costCents: 571 }
]

function topSkillRows(rows: SkillCostAttributionRow[]): PreviewRow[] {
  return rows
    .filter((row) => row.skillName !== null && row.estimatedCostCents > 0)
    .sort((first, second) => second.estimatedCostCents - first.estimatedCostCents)
    .slice(0, PREVIEW_ROWS)
    .map((row) => ({
      label: getSkillDisplayName(row.skillName as string, row.sourceType),
      share: row.share,
      costCents: row.estimatedCostCents
    }))
}

// A miniature of Usage › Skills › Estimated cost attribution, drawn with the same bar treatment
// as SkillAssociationTable but at card width; that table's 620px minimum cannot shrink this far.
export function UsageSkillCostPreview(): React.JSX.Element {
  const { data, isPending } = useQuery(usageOverviewQuery)
  if (isPending) return <PreviewSkeleton />
  const ownRows = data ? topSkillRows(data.skills.last30d.attribution.rows) : []
  const isSample = ownRows.length === 0
  const rows = isSample ? SAMPLE_ROWS : ownRows

  return (
    <div className="flex h-full flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium uppercase tracking-[0.04em] text-muted-foreground">
          Estimated cost · 30 days
        </span>
        {isSample && <SampleLabel />}
      </div>
      {rows.map((row) => (
        <div key={row.label} className="relative flex h-7 items-center gap-2 px-2">
          <span
            aria-hidden
            className="absolute inset-y-0 left-0 rounded-sm bg-usage-bar/[0.07] dark:bg-usage-bar/[0.12]"
            style={{ width: `${Math.max(row.share * 100, 2)}%` }}
          />
          <span className="relative min-w-0 flex-1 truncate text-[12px]">{row.label}</span>
          <span className="relative font-mono text-[11px] tabular-nums">
            {formatUsd(row.costCents / 100, { cents: true })}
          </span>
        </div>
      ))}
    </div>
  )
}
