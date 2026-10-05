import { useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { cn } from '@/lib/utils'
import { seriesColor, type ModelIdentity } from '@/lib/model-identity'
import { formatFamilyName, formatModelName, formatModelVersion } from './chart-utils'
import { buildShareBars, type ShareSegment, type ShareSeries } from './share-bars'

interface ShareBarsProps<T extends { model: string }> {
  rows: T[]
  series: ShareSeries<T>[] // one bar per series; the first sets the order for all of them
  identifyModel: (key: string) => ModelIdentity
  // Legend text after the name, from per-series values and shares (summed for a family entry).
  formatLegend: (values: number[], shares: string[], kind: 'family' | 'chip') => string
}

type Hover = { kind: 'family'; key: string } | { kind: 'model'; model: string } | null

const SEGMENT_GAP_PX = 2
const SEGMENT_MIN_WIDTH_PX = 3

// Segmented part-to-whole bars over one family-grouped legend (docs/usage-view-ui-spec.md §C2 and
// the Models share bars amendment). Cost's spend bar is the one-series, gutterless case; the Models
// panel pairs Turns over Output, sharing one hover state so a model lights up in both bars.
export function ShareBars<T extends { model: string }>({
  rows,
  series,
  identifyModel,
  formatLegend
}: ShareBarsProps<T>): React.JSX.Element {
  const reduceMotion = useReducedMotion() === true
  const [hovered, setHovered] = useState<Hover>(null)
  const { groups, bars, measure } = buildShareBars(rows, series, identifyModel)
  const hasGutter = bars.some((bar) => bar.label !== undefined)

  const isDimmed = (model: string, family: string): boolean =>
    hovered !== null &&
    (hovered.kind === 'family' ? hovered.key !== family : hovered.model !== model)

  const legendText = (subset: T[], kind: 'family' | 'chip'): string => {
    const { values, shares } = measure(subset)
    return formatLegend(values, shares, kind)
  }

  const renderBar = (segments: ShareSegment<T>[]): React.JSX.Element => {
    const gapWidth = Math.max(segments.length - 1, 0) * SEGMENT_GAP_PX
    return (
      <div className="flex h-2 w-full min-w-0 overflow-hidden rounded-[1px]">
        {segments.map((segment, index) => (
          <motion.div
            key={segment.row.model}
            className={cn(
              'h-full shrink transition-opacity duration-150',
              isDimmed(segment.row.model, segment.family) && 'opacity-40'
            )}
            style={{
              // Reserve paper gaps before dividing the bar; flex shrinking absorbs the
              // extra space needed by tiny segments' visibility floor.
              width: `calc((100% - ${gapWidth}px) * ${segment.fraction})`,
              minWidth: SEGMENT_MIN_WIDTH_PX,
              marginLeft: index === 0 ? 0 : SEGMENT_GAP_PX,
              backgroundColor: seriesColor(identifyModel(segment.row.model)),
              transformOrigin: 'left'
            }}
            onMouseEnter={() => setHovered({ kind: 'model', model: segment.row.model })}
            onMouseLeave={() => setHovered(null)}
            initial={reduceMotion ? false : { scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={
              reduceMotion
                ? { duration: 0 }
                : { duration: 0.32, ease: 'easeOut', delay: segment.order * 0.08 }
            }
          />
        ))}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        {bars.map((bar, index) =>
          hasGutter ? (
            // Fixed-width gutter so every bar starts at the same x and widths compare directly.
            <div key={index} className="flex items-center gap-3">
              <span className="w-14 shrink-0 text-[11px] font-medium uppercase tracking-[0.04em] text-muted-foreground">
                {bar.label}
              </span>
              {renderBar(bar.segments)}
            </div>
          ) : (
            <div key={index}>{renderBar(bar.segments)}</div>
          )
        )}
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
                <span className="text-muted-foreground">{legendText(group.rows, 'family')}</span>
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
                      <span className="text-muted-foreground">{legendText([entry], 'chip')}</span>
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
