import type { ModelIdentity } from '@/lib/model-identity'
import type { CostModelSpend } from '../../../../shared/ipc'
import { ShareBars } from './ShareBars'
import { percentLabel } from './share-bars'
import { formatModelName, formatUsd } from './chart-utils'

interface SpendBarProps {
  total: number // CostStats.totalCostUsd — the hero figure
  byModel: CostModelSpend[]
  identifyModel: (key: string) => ModelIdentity
}

// The merged headline + by-model object: a hero `$` numeral, one segmented part-to-whole bar
// directly under it (the GitHub repo-language-bar pattern), and a legend with one row per model
// family. Not a separate "by model" block, which would read as by-project twice. Not a donut: a
// small model becomes an invisible hairline arc, and a ring is the dashboard busyness DESIGN.md
// rejects.
export function SpendBar({ total, byModel, identifyModel }: SpendBarProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <span className="text-usage-stat text-foreground">
          {formatUsd(total, { cents: false })}
        </span>
        <span className="text-[11px] font-medium uppercase tracking-[0.04em] text-muted-foreground">
          Estimated API-equivalent cost
        </span>
      </div>
      <ShareBars
        rows={byModel}
        series={[{ value: (entry) => entry.costUsd, total }]}
        identifyModel={identifyModel}
        formatLegend={(values, shares) => `${formatUsd(values[0], { cents: true })} · ${shares[0]}`}
        detail={(entry) => {
          const spend = `${formatUsd(entry.costUsd, { cents: true })} · ${percentLabel(entry.costUsd, total)} of spend`
          // Same identity source as CostSection's older-version line.
          const newerKey = identifyModel(entry.model).newerKey
          return newerKey === null ? [spend] : [spend, `${formatModelName(newerKey)} is newer`]
        }}
      />
    </div>
  )
}
