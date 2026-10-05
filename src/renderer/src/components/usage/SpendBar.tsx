import type { ModelIdentity } from '@/lib/model-identity'
import type { CostModelSpend } from '../../../../shared/ipc'
import { ShareBars } from './ShareBars'
import { formatUsd } from './chart-utils'

interface SpendBarProps {
  total: number // CostStats.totalCostUsd — the hero figure
  byModel: CostModelSpend[]
  identifyModel: (key: string) => ModelIdentity
}

// The merged headline + by-model object (docs/usage-view-ui-spec.md §C2): a hero `$` numeral, one
// segmented part-to-whole bar directly under it (the GitHub repo-language-bar pattern), and a
// legend with one row per model family. Not a separate "by model" block, not a donut.
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
      />
    </div>
  )
}
