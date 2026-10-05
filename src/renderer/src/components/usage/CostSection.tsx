import { Fragment, useRef, useState } from 'react'
import { CircleDollarSign, TriangleAlert } from 'lucide-react'
import { getFolderBasename } from '@/lib/source-name'
import { olderVersionSummary, type ModelIdentity } from '@/lib/model-identity'
import type { CostHour, CostModelSpend, CostStats, CostWindowKey } from '../../../../shared/ipc'
import { ChartBlock } from './ChartBlock'
import { CostDetailsDialog, COST_ATTRIBUTION_NOTE } from './CostDetailsDialog'
import { CostHourStrip } from './CostHourStrip'
import { DayStrip } from './DayStrip'
import { Punchcard } from './Punchcard'
import { RankedList } from './RankedList'
import { SpendBar } from './SpendBar'
import { formatModelName, formatUsd } from './chart-utils'

const formatDollars = (value: number): string => formatUsd(value, { cents: true })

export function CostSection({
  cost,
  windowKey,
  identifyModel
}: {
  cost: CostStats | null
  windowKey: CostWindowKey
  identifyModel: (key: string) => ModelIdentity
}): React.JSX.Element {
  const [selectedBucket, setSelectedBucket] = useState<
    { kind: 'day'; key: string } | { kind: 'hour'; hour: CostHour } | null
  >(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  if (!cost)
    return (
      <section className="flex items-start gap-2 py-8 text-[13px] text-muted-foreground">
        <CircleDollarSign className="mt-0.5 size-4 shrink-0" />
        <p className="max-w-[520px]">
          No cost data yet. Claude Code started recording per-session cost in August 2026 —
          it&apos;ll show here after your next session and a rescan.
        </p>
      </section>
    )
  const window =
    windowKey === '24h' ? cost.last24h : windowKey === '7d' ? cost.last7d : cost.last30d
  const windowLabel = windowKey === '24h' ? '24 hours' : `${window.days} days`
  const empty = window.totalCostUsd === 0
  const emptyMessage = `No timestamped cost in the last ${windowLabel}`
  const selectedDetails =
    selectedBucket?.kind === 'day'
      ? (window.byDay.find((day) => day.date === selectedBucket.key) ?? null)
      : selectedBucket?.kind === 'hour'
        ? selectedBucket.hour
        : null
  return (
    <section className="flex flex-col gap-6 py-8">
      <div className="flex flex-col gap-2">
        <SpendBar
          total={window.totalCostUsd}
          byModel={window.byModel}
          identifyModel={identifyModel}
        />
        <OlderVersionNote
          total={window.totalCostUsd}
          byModel={window.byModel}
          identifyModel={identifyModel}
        />
        {window.hasUnknownModelCost && (
          <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
            <TriangleAlert className="mt-px size-3 shrink-0 text-warning" />
            Some usage ran on a model Claude Code couldn&apos;t price — the total above is a low
            estimate.
          </p>
        )}
        <p className="max-w-[520px] text-[11px] text-muted-foreground">
          What this would cost at pay-as-you-go API rates — not a charge. Most Claude Code usage
          runs on a subscription billed separately, and these estimates may not match your actual
          bill.
        </p>
        <p className="max-w-[520px] text-[11px] text-muted-foreground">{COST_ATTRIBUTION_NOTE}</p>
        <p className="text-[11px] text-muted-foreground">
          Covers {window.pricedSessionCount.toLocaleString()} contributing session
          {window.pricedSessionCount === 1 ? '' : 's'} in the last {windowLabel}.
        </p>
        {cost.undatedSessionCount > 0 && (
          <p className="max-w-[520px] text-[11px] text-muted-foreground">
            Across retained history, {formatDollars(cost.undatedCostUsd)} from{' '}
            {cost.undatedSessionCount.toLocaleString()} session
            {cost.undatedSessionCount === 1 ? '' : 's'} has no usable activity timestamps and is
            excluded from these windows.
          </p>
        )}
        {(cost.preTrackingSessionCount > 0 || cost.unusableSessionCount > 0) && (
          <p className="max-w-[520px] text-[11px] text-muted-foreground">
            Across retained history, {cost.preTrackingSessionCount.toLocaleString()} sessions
            predate cost tracking and {cost.unusableSessionCount.toLocaleString()} have no usable
            cost data.
          </p>
        )}
      </div>
      {windowKey === '24h' ? (
        <ChartBlock label="By hour" empty={empty} emptyMessage={emptyMessage}>
          <CostHourStrip
            data={window.byHourChronological}
            onSelectHour={(hour, trigger) => {
              triggerRef.current = trigger
              setSelectedBucket({ kind: 'hour', hour })
              setDialogOpen(true)
            }}
          />
        </ChartBlock>
      ) : (
        <>
          <ChartBlock label="By day" empty={empty} emptyMessage={emptyMessage}>
            <DayStrip
              days={window.days}
              data={window.byDay.map((day) => ({
                date: day.date,
                value: day.costUsd,
                weekday: day.weekday,
                partial: day.partial
              }))}
              formatValue={formatDollars}
              onSelectDay={(day, trigger) => {
                triggerRef.current = trigger
                setSelectedBucket({ kind: 'day', key: day.date })
                setDialogOpen(true)
              }}
            />
          </ChartBlock>
          <ChartBlock label="By time of day" empty={empty} emptyMessage={emptyMessage}>
            <Punchcard
              byHourWeekday={window.byHourWeekday}
              byHour={window.byHour}
              byWeekday={window.byWeekday}
              formatValue={formatDollars}
            />
          </ChartBlock>
        </>
      )}
      <ChartBlock label="By project" empty={empty} emptyMessage={emptyMessage}>
        <RankedList
          items={window.byProject.map((project) => ({
            label: getFolderBasename(project.project),
            fullLabel: project.project,
            value: project.costUsd
          }))}
          formatValue={formatDollars}
          noun="projects"
        />
      </ChartBlock>
      <CostDetailsDialog
        bucket={selectedDetails}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onRestoreFocus={() => triggerRef.current?.focus()}
        identifyModel={identifyModel}
      />
    </section>
  )
}

// States what ran and what's newer — no advice: an older version can be a deliberate pin
// (a subagent, a cost choice) that Megatron can't see. Thresholds live in `olderVersionSummary`.
function OlderVersionNote({
  total,
  byModel,
  identifyModel
}: {
  total: number
  byModel: CostModelSpend[]
  identifyModel: (key: string) => ModelIdentity
}): React.JSX.Element | null {
  const summary = olderVersionSummary(byModel, total, identifyModel)
  if (summary === null) return null
  const { items } = summary
  return (
    <p className="max-w-[520px] text-[11px] text-muted-foreground">
      {Math.round(summary.share * 100)}% of spend went to older versions
      {items.length === 0 ? '.' : ': '}
      {items.map((item, index) => (
        <Fragment key={item.model}>
          {index === 0 ? '' : index === items.length - 1 ? ' and ' : ', '}
          <span className="text-foreground">{formatModelName(item.model)}</span> (
          <span className="text-foreground">{formatModelName(item.newerKey)}</span> is newer)
        </Fragment>
      ))}
      {items.length === 0 ? '' : '.'}
    </p>
  )
}
