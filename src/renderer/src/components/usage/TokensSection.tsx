import { useState } from 'react'
import type { ProjectLabelResolver } from '@/lib/project-tree'
import { seriesColor, type ModelIdentity } from '@/lib/model-identity'
import type { SkillStatsWindowKey, TokenStats, TokenWindow } from '../../../../shared/ipc'
import { ChartBlock } from './ChartBlock'
import { RankedList } from './RankedList'
import { ProjectRankedList } from './ProjectRankedList'
import { TokenReadout } from './TokenReadout'
import { TokenValue } from './TokenValue'
import { formatExactTokenCount, formatTokenCount } from '../../../../shared/token-format'
import { formatCount, formatModelName } from './chart-utils'

export function TokensSection({
  stats,
  windowKey,
  identifyModel,
  resolveProjectLabel
}: {
  stats: TokenStats
  windowKey: SkillStatsWindowKey
  identifyModel: (key: string) => ModelIdentity
  resolveProjectLabel: ProjectLabelResolver
}): React.JSX.Element {
  const selected =
    windowKey === '24h' ? stats.last24h : windowKey === '7d' ? stats.last7d : stats.last30d
  return (
    <section className="flex flex-col gap-6 py-8">
      <div className="flex flex-col gap-4">
        <div>
          <p className="text-usage-stat text-foreground">
            {selected.tokens ? (
              <TokenValue
                value={selected.tokens.total}
                hint="Estimated share of recorded session totals"
              />
            ) : (
              '—'
            )}
          </p>
          <p className="mt-1 text-[11px] uppercase tracking-[0.04em] text-muted-foreground">
            Total tokens processed · estimated
          </p>
        </div>
        <TokenReadout tokens={selected.tokens} />
        <p className="max-w-[720px] text-[12px] text-muted-foreground">
          Input + output + cache reads + cache writes. Thinking is included in output. Time-based
          figures are estimated shares of recorded session totals, allocated using response
          activity.
        </p>
        {!selected.tokens && (
          <p role="status" className="text-[13px] text-muted-foreground">
            No tracked token data in this period. Token usage is unavailable, rather than zero.
          </p>
        )}
        {(stats.missingSessionCount > 0 || stats.undatedTokens.total > 0) && (
          <p className="text-[12px] text-muted-foreground">
            {stats.missingSessionCount > 0 &&
              `${formatCount(stats.missingSessionCount)} archived sessions have no usable token totals. `}
            {stats.undatedTokens.total > 0 && (
              <>
                <TokenValue value={stats.undatedTokens.total} /> recorded tokens have no response
                timestamp and cannot be assigned to a period.{' '}
              </>
            )}
            These gaps are excluded from the figures above.
          </p>
        )}
      </div>
      <ChartBlock
        label={windowKey === '24h' ? 'By hour' : 'By day'}
        empty={!selected.tokens}
        emptyMessage="No tracked token data in this period"
      >
        <TokenTrend key={windowKey} window={selected} hourly={windowKey === '24h'} />
      </ChartBlock>
      <ChartBlock
        label="By model"
        empty={selected.byModel.length === 0}
        emptyMessage="No tracked models in this period"
      >
        <RankedList
          items={selected.byModel.map((row) => ({
            label: formatModelName(row.key),
            fullLabel: row.key,
            value: row.tokens.total,
            swatch: seriesColor(identifyModel(row.key))
          }))}
          formatValue={formatTokenCount}
          formatExactValue={(value) => `${formatExactTokenCount(value)} tokens`}
          noun="models"
        />
      </ChartBlock>
      <ChartBlock
        label="By project"
        empty={selected.byProject.length === 0}
        emptyMessage="No tracked projects in this period"
      >
        <ProjectRankedList
          items={selected.byProject.map((row) => ({
            label: resolveProjectLabel(row.key),
            fullLabel: row.key,
            value: row.tokens.total
          }))}
          formatValue={formatTokenCount}
          formatExactValue={(value) => `${formatExactTokenCount(value)} tokens`}
          noun="projects"
        />
      </ChartBlock>
    </section>
  )
}

function TokenTrend({
  window,
  hourly
}: {
  window: TokenWindow
  hourly: boolean
}): React.JSX.Element {
  const [focused, setFocused] = useState<number | null>(null)
  const maximum = Math.max(1, ...window.trend.map((bucket) => bucket.tokens?.total ?? 0))
  const label = (index: number): string => {
    const bucket = window.trend[index]
    const start = new Date(bucket.startAt)
    const date = start.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      ...(hourly ? { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' } : {})
    })
    const partial = !hourly && (start.getHours() !== 0 || new Date(bucket.endAt).getHours() !== 0)
    return `${date} · ${bucket.tokens ? `${formatTokenCount(bucket.tokens.total)} estimated tokens` : 'No recorded token data'}${partial ? ' · partial day' : ''}`
  }
  return (
    <div>
      <div
        className="flex h-[88px] items-end gap-[3px] border-b border-border"
        onMouseLeave={() => setFocused(null)}
      >
        {window.trend.map((bucket, index) => (
          <button
            key={bucket.key}
            type="button"
            aria-label={`${label(index)}${bucket.tokens ? ` · ${formatExactTokenCount(bucket.tokens.total)} exact tokens` : ''}`}
            onMouseEnter={() => setFocused(index)}
            onFocus={() => setFocused(index)}
            onBlur={() => setFocused(null)}
            className="relative flex h-full min-w-0 flex-1 items-end outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <span
              aria-hidden
              className="w-full rounded-[1px] bg-usage-bar transition-opacity motion-reduce:transition-none"
              style={{
                height: `${bucket.tokens?.total ? Math.max(3, (bucket.tokens.total / maximum) * 100) : 0}%`,
                opacity: focused === null || focused === index ? 1 : 0.35
              }}
            />
          </button>
        ))}
      </div>
      <div className="mt-2 min-h-10 text-[11px] text-muted-foreground" aria-live="polite">
        {focused !== null ? (
          <>
            <p>{label(focused)}</p>
            {window.trend[focused].tokens && (
              <p className="mt-1 opacity-75">
                {formatExactTokenCount(window.trend[focused].tokens.total)} exact tokens
              </p>
            )}
          </>
        ) : (
          <div className="flex justify-between gap-4">
            <span>
              {new Date(window.startAt).toLocaleString(undefined, {
                month: 'short',
                day: 'numeric',
                ...(hourly ? { hour: 'numeric' } : {})
              })}
            </span>
            <span>Now · partial period</span>
          </div>
        )}
      </div>
    </div>
  )
}
