import { useEffect, useState } from 'react'
import type {
  EffortBucket,
  ModelStats,
  ModelStatsWindow,
  ModelTurnSummary,
  SkillStatsWindowKey
} from '../../../../shared/ipc'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { groupByFamily, seriesColor, type ModelIdentity } from '@/lib/model-identity'
import { ChartBlock } from './ChartBlock'
import { SegmentBar } from './SegmentBar'
import { ShareBars } from './ShareBars'
import { percentLabel, type ShareSeries } from './share-bars'
import { formatCount, formatModelName } from './chart-utils'

const EFFORT_LABELS: Record<EffortBucket, string> = {
  xhigh: 'Xhigh',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  not_recorded: 'Not recorded'
}

// Effort is ordinal, so a neutral ink ramp carries the order by lightness alone — no hue that
// could read as a model family in the same rows. Solid oklab mixes toward the paper, the same
// mechanism as `seriesColor`'s version tints. Not recorded is off the scale, so it's a hatch
// (`usage-fill-unrecorded`), never a step.
const EFFORT_FILL: Record<EffortBucket, string | undefined> = {
  xhigh: 'var(--usage-bar)',
  high: 'color-mix(in oklab, var(--usage-bar) 65%, var(--background))',
  medium: 'color-mix(in oklab, var(--usage-bar) 40%, var(--background))',
  low: 'color-mix(in oklab, var(--usage-bar) 22%, var(--background))',
  not_recorded: undefined
}

const FOOTER_ROW = '' // row-hover key for the footer; never a model key

const TURNS_HINT = 'Model responses, including subagents. One prompt usually takes several.'

function selectedWindow(stats: ModelStats, key: SkillStatsWindowKey): ModelStatsWindow {
  if (key === '24h') return stats.last24h
  if (key === '7d') return stats.last7d
  return stats.last30d
}

export function ModelsSection({
  stats,
  windowKey,
  identifyModel
}: {
  stats: ModelStats
  windowKey: SkillStatsWindowKey
  identifyModel: (key: string) => ModelIdentity
}): React.JSX.Element {
  const window = selectedWindow(stats, windowKey)
  // Same family-grouped, newest-first order as the Cost spend bar, so both panels read alike.
  const matrix = groupByFamily(window.matrix, (row) => row.total, identifyModel).flatMap(
    (group) => group.rows
  )
  const outputByModel = new Map(window.byModel.map((row) => [row.model, row.outputTokens]))
  const emptyMessage = `No model activity in the last ${windowKey === '24h' ? '24 hours' : windowKey === '7d' ? '7 days' : '30 days'}`
  const showNotRecorded = window.byEffort.some((row) => row.effort === 'not_recorded')
  const effortColumns: EffortBucket[] = showNotRecorded
    ? ['xhigh', 'high', 'medium', 'low', 'not_recorded']
    : ['xhigh', 'high', 'medium', 'low']
  const effortTotals = Object.fromEntries(
    effortColumns.map((effort) => [
      effort,
      window.byEffort.find((row) => row.effort === effort)?.turnCount ?? 0
    ])
  ) as Record<EffortBucket, number>
  const shareSeries: ShareSeries<ModelTurnSummary>[] = [
    { label: 'Turns', value: (row) => row.turnCount, total: window.turnCount },
    // Same card as the Turns segment above it, so only Turns takes focus and is read out.
    {
      label: 'Output',
      value: (row) => row.outputTokens,
      total: window.outputTokens,
      focusable: false
    }
  ]

  // A click selects an effort across every row; hover only dims within its own row, so scanning
  // the table doesn't flicker every row at once.
  const [selectedEffort, setSelectedEffort] = useState<EffortBucket | null>(null)
  const [rowHover, setRowHover] = useState<{ rowKey: string; effort: EffortBucket } | null>(null)
  // Not recorded can vanish on a window switch; hold the selection and resume when it's back.
  const activeEffort =
    selectedEffort !== null && effortColumns.includes(selectedEffort) ? selectedEffort : null

  useEffect(() => {
    if (selectedEffort === null) return
    const clearOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setSelectedEffort(null)
    }
    // `document`, not `window`: the selected stats window shadows the global here.
    document.addEventListener('keydown', clearOnEscape)
    return () => document.removeEventListener('keydown', clearOnEscape)
  }, [selectedEffort])

  const renderEffortBar = (
    rowKey: string,
    title: string,
    counts: Record<EffortBucket, number>,
    scope: string
  ): React.JSX.Element => {
    const present = effortColumns.filter((effort) => counts[effort] > 0)
    const total = present.reduce((sum, effort) => sum + counts[effort], 0)
    const focused = rowHover?.rowKey === rowKey ? rowHover.effort : activeEffort
    return (
      <SegmentBar
        hit="row"
        segments={present.map((effort) => ({
          key: effort,
          fraction: counts[effort] / total,
          fill: EFFORT_FILL[effort],
          className: effortFillClass(effort),
          dimmed: focused !== null && effort !== focused,
          card: {
            title: `${title} · ${EFFORT_LABELS[effort]}`,
            lines: [
              `${formatCount(counts[effort])} ${counts[effort] === 1 ? 'turn' : 'turns'} · ${percentLabel(counts[effort], total)} ${scope}`
            ]
          },
          focusable: true,
          onSelect: () => setSelectedEffort(activeEffort === effort ? null : effort),
          pressed: activeEffort === effort
        }))}
        onActivate={(effort) => setRowHover({ rowKey, effort })}
        onDeactivate={() => setRowHover(null)}
      />
    )
  }

  const totalReadout = (counts: Record<EffortBucket, number>, total: number): React.ReactNode =>
    activeEffort === null ? (
      formatCount(total)
    ) : (
      <>
        {formatCount(counts[activeEffort])}
        <span className="text-muted-foreground"> / {formatCount(total)}</span>
      </>
    )

  return (
    <section className="flex flex-col gap-6 py-8">
      <div className="flex flex-wrap items-start gap-x-10 gap-y-4">
        <ModelStat label="Turns" value={window.turnCount} hint={TURNS_HINT} />
        <span aria-hidden className="mt-1 hidden h-9 w-px bg-border sm:block" />
        <ModelStat label="Models" value={window.modelCount} />
        <span aria-hidden className="mt-1 hidden h-9 w-px bg-border sm:block" />
        <ModelStat label="Output tokens" value={window.outputTokens} />
      </div>

      <ChartBlock label="By model" empty={window.turnCount === 0} emptyMessage={emptyMessage}>
        <ShareBars
          rows={window.byModel}
          series={shareSeries}
          identifyModel={identifyModel}
          // A family entry names the units once; its version chips inherit that order.
          formatLegend={(_, shares, kind) =>
            kind === 'family'
              ? `${shares[0]} turns · ${shares[1]} output`
              : `${shares[0]} · ${shares[1]}`
          }
          detail={(row) => [
            `${formatCount(row.turnCount)} ${row.turnCount === 1 ? 'turn' : 'turns'} · ${percentLabel(row.turnCount, window.turnCount)}`,
            `${formatCount(row.outputTokens)} output tokens · ${percentLabel(row.outputTokens, window.outputTokens)}`,
            ...(row.turnCount > 0
              ? [`${formatCount(Math.round(row.outputTokens / row.turnCount))} tokens per turn`]
              : [])
          ]}
        />
      </ChartBlock>

      <ChartBlock label="Model × effort" empty={window.turnCount === 0} emptyMessage={emptyMessage}>
        <div className="flex flex-col gap-3">
          {/* min-w fits the ~544px content width at the 860px window minimum (rail + sidebar +
              gutters), so the table never scrolls sideways; below it the Effort bar gets cramped. */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left">
              <thead>
                <tr className="h-7 border-b border-border text-[11px] uppercase tracking-[0.04em] text-muted-foreground">
                  {/* w-px: Model hugs its longest name so the Effort column takes the slack. */}
                  <th className="w-px pr-4 font-medium">Model</th>
                  <th className="pr-4 font-medium">Effort</th>
                  <th className="w-32 whitespace-nowrap text-right font-medium">
                    {activeEffort === null ? 'Total' : `${EFFORT_LABELS[activeEffort]} / Total`}
                  </th>
                  <th className="w-28 border-l border-border pl-3 text-right font-medium">
                    Output tokens
                  </th>
                </tr>
              </thead>
              <tbody>
                {matrix.map((row) => (
                  <tr key={row.model} className="h-8 border-b border-border last:border-b-0">
                    <td className="pr-4 text-[13px]" title={row.model}>
                      <span className="flex items-center gap-1.5 whitespace-nowrap">
                        <span
                          aria-hidden
                          className="size-2 shrink-0 rounded-full"
                          style={{ backgroundColor: seriesColor(identifyModel(row.model)) }}
                        />
                        {formatModelName(row.model)}
                      </span>
                    </td>
                    <td className="pr-4">
                      {renderEffortBar(
                        row.model,
                        formatModelName(row.model),
                        row.byEffort,
                        "of this model's turns"
                      )}
                    </td>
                    <td className="text-right font-mono text-[12px] font-medium tabular-nums">
                      {totalReadout(row.byEffort, row.total)}
                    </td>
                    <td className="border-l border-border pl-3 text-right font-mono text-[12px] tabular-nums text-muted-foreground">
                      {formatCount(outputByModel.get(row.model) ?? 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="h-8 border-t border-border font-medium">
                  <td className="pr-4 text-[12px]">Total</td>
                  <td className="pr-4">
                    {renderEffortBar(FOOTER_ROW, 'All models', effortTotals, 'of all turns')}
                  </td>
                  <td className="text-right font-mono text-[12px] tabular-nums">
                    {totalReadout(effortTotals, window.turnCount)}
                  </td>
                  <td className="border-l border-border pl-3 text-right font-mono text-[12px] tabular-nums">
                    {formatCount(window.outputTokens)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* A plain key, not a control: it only mirrors the selection. */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted-foreground">
            {effortColumns.map((effort) => (
              <span
                key={effort}
                className={cn(
                  'flex items-center gap-1.5 transition-opacity duration-150',
                  activeEffort !== null && effort !== activeEffort && 'opacity-40'
                )}
              >
                <EffortSwatch effort={effort} />
                {EFFORT_LABELS[effort]}
              </span>
            ))}
          </div>
        </div>
      </ChartBlock>
    </section>
  )
}

function effortFillClass(effort: EffortBucket): string | undefined {
  return effort === 'not_recorded' ? 'usage-fill-unrecorded' : undefined
}

function EffortSwatch({ effort }: { effort: EffortBucket }): React.JSX.Element {
  return (
    <span
      aria-hidden
      className={cn('size-2 shrink-0 rounded-[1px]', effortFillClass(effort))}
      style={{ backgroundColor: EFFORT_FILL[effort] }}
    />
  )
}

function ModelStat({
  label,
  value,
  hint
}: {
  label: string
  value: number
  hint?: string
}): React.JSX.Element {
  const labelClass = 'text-[11px] font-medium uppercase tracking-[0.04em] text-muted-foreground'
  return (
    <div className="flex min-w-24 flex-col gap-1">
      <span className="text-usage-stat text-foreground">{formatCount(value)}</span>
      {hint === undefined ? (
        <span className={labelClass}>{label}</span>
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              tabIndex={0}
              className={cn(
                labelClass,
                'self-start cursor-help rounded-[2px] underline decoration-dotted underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring'
              )}
            >
              {label}
            </span>
          </TooltipTrigger>
          <TooltipContent>{hint}</TooltipContent>
        </Tooltip>
      )}
    </div>
  )
}
