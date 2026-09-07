import { useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { cn } from '@/lib/utils'
import type { CostModelSpend } from '../../../../shared/ipc'
import { formatModelName, formatUsd, modelSeriesVar } from './chart-utils'

interface SpendBarProps {
  total: number // CostStats.totalCostUsd — the hero figure
  byModel: CostModelSpend[] // desc by cost
}

// The merged headline + by-model object (docs/usage-view-ui-spec.md §C2): a hero `$` numeral, one
// segmented part-to-whole bar directly under it (the GitHub repo-language-bar pattern), and an
// inline legend. Not a separate "by model" block, not a donut.
export function SpendBar({ total, byModel }: SpendBarProps): React.JSX.Element {
  const reduceMotion = useReducedMotion() === true
  const [hovered, setHovered] = useState<string | null>(null)

  // Segment widths are relative to the hero total so a `hasUnknownModelCost` undercount shows as
  // real trailing slack (explained by the §C6.2 caveat line), never overflow.
  const modelSum = byModel.reduce((sum, entry) => sum + entry.costUsd, 0)
  const denom = Math.max(total, modelSum, 1)

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

      <div className="flex h-2 w-full overflow-hidden rounded-[1px]">
        {byModel.map((entry, index) => (
          <motion.div
            key={entry.model}
            className={cn(
              'h-full shrink-0 transition-opacity duration-150',
              hovered !== null && hovered !== entry.model && 'opacity-40'
            )}
            style={{
              width: `${(entry.costUsd / denom) * 100}%`,
              minWidth: entry.costUsd > 0 ? 3 : 0,
              marginLeft: index === 0 ? 0 : 2,
              backgroundColor: modelSeriesVar(entry.model),
              transformOrigin: 'left'
            }}
            onMouseEnter={() => setHovered(entry.model)}
            onMouseLeave={() => setHovered(null)}
            initial={reduceMotion ? false : { scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={
              reduceMotion
                ? { duration: 0 }
                : { duration: 0.32, ease: 'easeOut', delay: index * 0.08 }
            }
          />
        ))}
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-1">
        {byModel.map((entry) => {
          const pct = total > 0 ? (entry.costUsd / total) * 100 : 0
          return (
            <span
              key={entry.model}
              className="flex items-center gap-1.5 text-[13px]"
              onMouseEnter={() => setHovered(entry.model)}
              onMouseLeave={() => setHovered(null)}
            >
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: modelSeriesVar(entry.model) }}
              />
              <span>{formatModelName(entry.model)}</span>
              <span className="text-muted-foreground">
                {formatUsd(entry.costUsd, { cents: true })} ·{' '}
                {pct < 1 ? '<1%' : `${Math.round(pct)}%`}
              </span>
            </span>
          )
        })}
      </div>
    </div>
  )
}
