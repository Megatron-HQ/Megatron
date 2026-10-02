import { useRef, useState } from 'react'
import { CircleDollarSign, TriangleAlert } from 'lucide-react'
import { getFolderBasename } from '@/lib/source-name'
import type { CostStats, CostWindowKey } from '../../../../shared/ipc'
import { ChartBlock } from './ChartBlock'
import { CostDayDialog, COST_ATTRIBUTION_NOTE } from './CostDayDialog'
import { CostHourStrip } from './CostHourStrip'
import { DayStrip } from './DayStrip'
import { Punchcard } from './Punchcard'
import { RankedList } from './RankedList'
import { SpendBar } from './SpendBar'
import { formatUsd } from './chart-utils'

const formatDollars = (value: number): string => formatUsd(value, { cents: true })

export function CostSection({
  cost,
  windowKey
}: {
  cost: CostStats | null
  windowKey: CostWindowKey
}): React.JSX.Element {
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
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
  const selectedDay = window.byDay.find((day) => day.date === selectedDate) ?? null
  return (
    <section className="flex flex-col gap-6 py-8">
      <div className="flex flex-col gap-2">
        <SpendBar total={window.totalCostUsd} byModel={window.byModel} />
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
          <CostHourStrip data={window.byHourChronological} />
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
                setSelectedDate(day.date)
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
      <CostDayDialog
        day={selectedDay}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onRestoreFocus={() => triggerRef.current?.focus()}
      />
    </section>
  )
}
