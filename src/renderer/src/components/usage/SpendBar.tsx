import { useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { cn } from '@/lib/utils'
import { groupByFamily, seriesColor, type ModelIdentity } from '@/lib/model-identity'
import type { CostModelSpend } from '../../../../shared/ipc'
import { formatFamilyName, formatModelName, formatModelVersion, formatUsd } from './chart-utils'

interface SpendBarProps {
  total: number // CostStats.totalCostUsd — the hero figure
  byModel: CostModelSpend[]
  identifyModel: (key: string) => ModelIdentity
}

type Hover = { kind: 'family'; key: string } | { kind: 'model'; model: string } | null

const SEGMENT_GAP_PX = 2
const SEGMENT_MIN_WIDTH_PX = 3

function percentLabel(value: number, total: number): string {
  const pct = total > 0 ? (value / total) * 100 : 0
  return pct < 1 ? '<1%' : `${Math.round(pct)}%`
}

// The merged headline + by-model object (docs/usage-view-ui-spec.md §C2): a hero `$` numeral, one
// segmented part-to-whole bar directly under it (the GitHub repo-language-bar pattern), and a
// legend with one row per model family. Not a separate "by model" block, not a donut.
export function SpendBar({ total, byModel, identifyModel }: SpendBarProps): React.JSX.Element {
  const reduceMotion = useReducedMotion() === true
  const [hovered, setHovered] = useState<Hover>(null)

  // Segment widths are relative to the hero total so a `hasUnknownModelCost` undercount shows as
  // real trailing slack (explained by the §C6.2 caveat line), never overflow.
  const modelSum = byModel.reduce((sum, entry) => sum + entry.costUsd, 0)
  const denom = Math.max(total, modelSum) || 1
  const groups = groupByFamily(byModel, (entry) => entry.costUsd, identifyModel)
  const segments = groups.flatMap((group) =>
    group.rows
      .filter((entry) => entry.costUsd > 0)
      .map((entry) => ({ ...entry, family: group.key }))
  )
  const gapWidth = Math.max(segments.length - 1, 0) * SEGMENT_GAP_PX

  const isDimmed = (model: string, family: string): boolean =>
    hovered !== null &&
    (hovered.kind === 'family' ? hovered.key !== family : hovered.model !== model)

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
        {segments.map((entry, index) => (
          <motion.div
            key={entry.model}
            className={cn(
              'h-full shrink transition-opacity duration-150',
              isDimmed(entry.model, entry.family) && 'opacity-40'
            )}
            style={{
              // Reserve paper gaps before dividing the bar; flex shrinking absorbs the
              // extra space needed by tiny segments' visibility floor.
              width: `calc((100% - ${gapWidth}px) * ${entry.costUsd / denom})`,
              minWidth: SEGMENT_MIN_WIDTH_PX,
              marginLeft: index === 0 ? 0 : SEGMENT_GAP_PX,
              backgroundColor: seriesColor(identifyModel(entry.model)),
              transformOrigin: 'left'
            }}
            onMouseEnter={() => setHovered({ kind: 'model', model: entry.model })}
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

      {/* Family name in column 1, its version chips wrapping inside column 2 — so at narrow
          widths chips stay indented under their family instead of reflowing into the next one. */}
      <div className="grid grid-cols-[max-content_minmax(0,1fr)] items-baseline gap-x-6 gap-y-1.5 text-[13px]">
        {groups.map((group) => {
          const single = group.rows.length === 1
          const familyDot = seriesColor({ ...identifyModel(group.rows[0].model), tintStep: 0 })
          return (
            <div key={group.key} className="contents">
              <span
                className="flex items-center gap-1.5"
                onMouseEnter={() =>
                  setHovered(
                    single
                      ? { kind: 'model', model: group.rows[0].model }
                      : { kind: 'family', key: group.key }
                  )
                }
                onMouseLeave={() => setHovered(null)}
              >
                <span
                  aria-hidden
                  className="size-2 shrink-0 self-center rounded-full"
                  style={{
                    backgroundColor: single
                      ? seriesColor(identifyModel(group.rows[0].model))
                      : familyDot
                  }}
                />
                <span>
                  {single ? formatModelName(group.rows[0].model) : formatFamilyName(group.key)}
                </span>
                <span className="text-muted-foreground">
                  {formatUsd(group.total, { cents: true })} · {percentLabel(group.total, total)}
                </span>
              </span>
              <span className="flex flex-wrap gap-x-4 gap-y-1">
                {!single &&
                  group.rows.map((entry) => (
                    <span
                      key={entry.model}
                      className="flex items-center gap-1.5"
                      title={formatModelName(entry.model)}
                      onMouseEnter={() => setHovered({ kind: 'model', model: entry.model })}
                      onMouseLeave={() => setHovered(null)}
                    >
                      <span
                        aria-hidden
                        className="size-2 shrink-0 self-center rounded-[1px]"
                        style={{ backgroundColor: seriesColor(identifyModel(entry.model)) }}
                      />
                      <span>{formatModelVersion(entry.model)}</span>
                      <span className="text-muted-foreground">
                        {formatUsd(entry.costUsd, { cents: true })} ·{' '}
                        {percentLabel(entry.costUsd, total)}
                      </span>
                    </span>
                  ))}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
