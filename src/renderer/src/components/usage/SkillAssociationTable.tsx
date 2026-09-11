import { useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { TriangleAlert } from 'lucide-react'
import type { SkillCostAttribution } from '../../../../shared/ipc'
import { TextLink } from '@/components/TextLink'
import { formatCount, formatUsd } from './chart-utils'

const INITIAL_ROWS = 8

export function SkillAssociationTable({
  attribution,
  onSelectSkill
}: {
  attribution: SkillCostAttribution
  onSelectSkill?: (skillId: number) => void
}): React.JSX.Element {
  const reduceMotion = useReducedMotion() === true
  const [expanded, setExpanded] = useState(false)
  const visibleRows = expanded ? attribution.rows : attribution.rows.slice(0, INITIAL_ROWS)
  const hiddenCount = Math.max(0, attribution.rows.length - INITIAL_ROWS)

  return (
    <div className="flex flex-col gap-2">
      <p className="max-w-[620px] text-[11px] text-muted-foreground">
        Estimated API-equivalent cost is attributed within each priced model by output-token share.
        Unpriced, unmatched, and residual cost is assigned to General work. Rows are additive and
        cover all cost-tracked history, independent of the activity window above.
      </p>
      {attribution.hasUnknownModelCost && (
        <p className="flex max-w-[620px] items-start gap-1.5 text-[11px] text-muted-foreground">
          <TriangleAlert className="mt-px size-3 shrink-0 text-warning" />
          Some turns used a model Claude Code could not price, so these estimates are a low bound.
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] table-fixed text-left">
          <thead>
            <tr className="h-7 border-b border-border text-[11px] font-medium uppercase tracking-[0.04em] text-muted-foreground">
              <th className="pr-4 font-medium">Work bucket</th>
              <th className="w-32 text-right font-medium">Tracked sessions</th>
              <th className="w-24 text-right font-medium">Share</th>
              <th className="w-32 text-right font-medium">Estimated cost</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => {
              const clickable = row.skillId !== null && onSelectSkill !== undefined
              const label = row.skillName ?? 'General work'
              return (
                <tr
                  key={row.skillName ?? '__general__'}
                  className="group relative h-8 border-b border-border"
                >
                  <td className="max-w-0 pr-4">
                    <span
                      aria-hidden
                      className="absolute inset-y-0 left-0 bg-usage-bar/[0.07] transition-colors duration-150 group-hover:bg-usage-bar/[0.11] dark:bg-usage-bar/[0.12]"
                      style={{
                        width: `${row.share * 100}%`,
                        minWidth: row.estimatedCostCents > 0 ? 2 : undefined
                      }}
                    />
                    <span className="relative flex min-w-0 items-center gap-1.5">
                      {clickable ? (
                        <TextLink
                          className="min-w-0 text-[13px]"
                          onClick={() => onSelectSkill?.(row.skillId as number)}
                        >
                          <span className="truncate" title={label}>
                            {label}
                          </span>
                        </TextLink>
                      ) : (
                        <span className="truncate text-[13px]" title={label}>
                          {label}
                        </span>
                      )}
                      {row.sourceType && (
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          {row.sourceType}
                        </span>
                      )}
                      {row.skillName !== null && row.skillId === null && (
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          unresolved
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="relative w-32 text-right font-mono text-[12px] tabular-nums text-muted-foreground">
                    {formatCount(row.trackedSessionCount)}
                  </td>
                  <td className="relative w-24 text-right font-mono text-[12px] tabular-nums text-muted-foreground">
                    {(row.share * 100).toFixed(1)}%
                  </td>
                  <td className="relative w-32 text-right font-mono text-[12px] tabular-nums text-foreground">
                    {formatUsd(row.estimatedCostCents / 100, { cents: true })}
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr className="h-8 border-t border-border font-medium">
              <td className="pr-4 text-[12px]">Total</td>
              <td className="text-right font-mono text-[12px] tabular-nums">
                {formatCount(attribution.trackedSessionCount)}
              </td>
              <td className="text-right font-mono text-[12px] tabular-nums">100.0%</td>
              <td className="text-right font-mono text-[12px] tabular-nums">
                {formatUsd(attribution.totalEstimatedCostCents / 100, { cents: true })}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
      <AnimatePresence initial={false}>
        {hiddenCount > 0 && (
          <motion.button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="self-start text-[11px] font-medium uppercase tracking-[0.04em] text-muted-foreground hover:text-foreground"
            initial={reduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: reduceMotion ? 0 : 0.15 }}
          >
            {expanded ? 'Show fewer' : `+ ${hiddenCount} more buckets`}
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  )
}
