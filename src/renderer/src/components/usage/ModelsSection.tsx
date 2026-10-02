import type {
  EffortBucket,
  ModelStats,
  ModelStatsWindow,
  SkillStatsWindowKey
} from '../../../../shared/ipc'
import { ChartBlock } from './ChartBlock'
import { RankedList } from './RankedList'
import { formatCount, formatModelName } from './chart-utils'

const EFFORT_LABELS: Record<EffortBucket, string> = {
  xhigh: 'Xhigh',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  not_recorded: 'Not recorded'
}

function selectedWindow(stats: ModelStats, key: SkillStatsWindowKey): ModelStatsWindow {
  if (key === '24h') return stats.last24h
  if (key === '7d') return stats.last7d
  return stats.last30d
}

export function ModelsSection({
  stats,
  windowKey
}: {
  stats: ModelStats
  windowKey: SkillStatsWindowKey
}): React.JSX.Element {
  const window = selectedWindow(stats, windowKey)
  const emptyMessage = `No model activity in the last ${windowKey === '24h' ? '24 hours' : windowKey === '7d' ? '7 days' : '30 days'}`
  const showNotRecorded = window.byEffort.some((row) => row.effort === 'not_recorded')
  const effortColumns: EffortBucket[] = showNotRecorded
    ? ['xhigh', 'high', 'medium', 'low', 'not_recorded']
    : ['xhigh', 'high', 'medium', 'low']

  return (
    <section className="flex flex-col gap-6 py-8">
      <div className="flex flex-wrap items-start gap-x-10 gap-y-4">
        <ModelStat label="Turns" value={window.turnCount} />
        <span aria-hidden className="mt-1 hidden h-9 w-px bg-border sm:block" />
        <ModelStat label="Models" value={window.modelCount} />
        <span aria-hidden className="mt-1 hidden h-9 w-px bg-border sm:block" />
        <ModelStat label="Output tokens" value={window.outputTokens} />
      </div>

      <ChartBlock label="By model" empty={window.turnCount === 0} emptyMessage={emptyMessage}>
        <RankedList
          items={window.byModel.map((row) => ({
            label: formatModelName(row.model),
            fullLabel: row.model,
            value: row.turnCount
          }))}
          formatValue={formatCount}
          noun="models"
        />
      </ChartBlock>

      <ChartBlock label="By effort" empty={window.turnCount === 0} emptyMessage={emptyMessage}>
        <RankedList
          items={window.byEffort.map((row) => ({
            label: EFFORT_LABELS[row.effort],
            fullLabel: EFFORT_LABELS[row.effort],
            value: row.turnCount
          }))}
          formatValue={formatCount}
          noun="effort levels"
        />
      </ChartBlock>

      <ChartBlock label="Model × effort" empty={window.turnCount === 0} emptyMessage={emptyMessage}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left">
            <thead>
              <tr className="h-7 border-b border-border text-[11px] uppercase tracking-[0.04em] text-muted-foreground">
                <th className="pr-4 font-medium">Model</th>
                {effortColumns.map((effort) => (
                  <th key={effort} className="w-24 text-right font-medium">
                    {EFFORT_LABELS[effort]}
                  </th>
                ))}
                <th className="w-20 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {window.matrix.map((row) => (
                <tr key={row.model} className="h-8 border-b border-border last:border-b-0">
                  <td className="pr-4 text-[13px]" title={row.model}>
                    {formatModelName(row.model)}
                  </td>
                  {effortColumns.map((effort) => (
                    <td
                      key={effort}
                      className="text-right font-mono text-[12px] tabular-nums text-muted-foreground"
                    >
                      {formatCount(row.byEffort[effort])}
                    </td>
                  ))}
                  <td className="text-right font-mono text-[12px] font-medium tabular-nums">
                    {formatCount(row.total)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="h-8 border-t border-border font-medium">
                <td className="pr-4 text-[12px]">Total</td>
                {effortColumns.map((effort) => (
                  <td key={effort} className="text-right font-mono text-[12px] tabular-nums">
                    {formatCount(
                      window.byEffort.find((row) => row.effort === effort)?.turnCount ?? 0
                    )}
                  </td>
                ))}
                <td className="text-right font-mono text-[12px] tabular-nums">
                  {formatCount(window.turnCount)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </ChartBlock>
    </section>
  )
}

function ModelStat({ label, value }: { label: string; value: number }): React.JSX.Element {
  return (
    <div className="flex min-w-24 flex-col gap-1">
      <span className="text-usage-stat text-foreground">{formatCount(value)}</span>
      <span className="text-[11px] font-medium uppercase tracking-[0.04em] text-muted-foreground">
        {label}
      </span>
    </div>
  )
}
