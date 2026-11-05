import { useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { useUsageProjects } from '@/lib/use-usage-projects'
import type { UsageCalendar } from '../../../../shared/ipc'
import { ActivityDetailsDialog } from './ActivityDetailsDialog'
import { ContributionGraph } from './ContributionGraph'
import { ProjectTimeline } from './ProjectTimeline'
import { formatCount } from './chart-utils'

function shortDate(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric'
  })
}

export function HistoryYearToggle({
  year,
  years,
  onChange
}: {
  year: number
  years: number[]
  onChange: (year: number) => void
}): React.JSX.Element {
  return (
    <nav
      aria-label="Contribution year"
      className="flex min-w-0 max-w-full gap-1 overflow-x-auto rounded-md border border-border p-0.5"
    >
      {years.map((value) => (
        <button
          key={value}
          type="button"
          aria-current={year === value ? 'date' : undefined}
          onClick={() => onChange(value)}
          className={cn(
            'shrink-0 rounded-sm px-2 py-0.5 font-mono text-[12px] outline-none focus-visible:ring-1 focus-visible:ring-ring',
            year === value
              ? 'bg-muted text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {value}
        </button>
      ))}
    </nav>
  )
}

export function HistorySkeleton(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-6 py-8">
      <Skeleton className="h-3 w-64 max-w-full" />
      <div className="grid grid-cols-2 gap-5 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <div key={index} className="flex flex-col gap-2">
            <Skeleton className="h-8 w-20" />
            <Skeleton className="h-3 w-24" />
          </div>
        ))}
      </div>
      <section aria-label="Contribution graph" className="flex flex-col gap-3">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-[110px] w-full" />
      </section>
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-[180px] w-full" />
    </div>
  )
}

export function HistorySection({
  data,
  pending,
  loadError,
  onRetry
}: {
  data: UsageCalendar | undefined
  pending: boolean
  loadError: boolean
  onRetry: () => void
}): React.JSX.Element {
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const details = useQuery({
    queryKey: ['usage', 'day', selectedDate],
    queryFn: () => window.api.getUsageDay(selectedDate!),
    enabled: selectedDate !== null
  })
  const { resolveProjectLabel } = useUsageProjects()

  if (loadError) {
    return (
      <div role="alert" className="py-8 text-[13px] text-muted-foreground">
        Could not load contribution history.{' '}
        <button type="button" onClick={onRetry} className="underline underline-offset-2">
          Retry
        </button>
      </div>
    )
  }
  if (pending || !data) return <HistorySkeleton />

  const { summary } = data
  const { longestStreak, busiestDay } = summary
  const hasObservations = summary.observedDays > 0 || data.prompts > 0
  const unavailableDays = summary.elapsedDays - summary.observedDays
  const selectDay = (date: string, element: HTMLButtonElement): void => {
    trigger.current = element
    setSelectedDate(date)
  }

  return (
    <section aria-label={`History for ${data.year}`} className="flex flex-col gap-6 py-8">
      <p className="text-[11px] text-muted-foreground">
        {data.year === new Date().getFullYear() ? 'Year to date' : data.year}
        {' · '}Based on {formatCount(summary.observedDays)} observed days
        {summary.partialDays > 0 && ` · ${formatCount(summary.partialDays)} partial`}
        {unavailableDays > 0 && ` · ${formatCount(unavailableDays)} unavailable`}
      </p>

      <div
        role="group"
        aria-label="Annual summary"
        className="grid grid-cols-2 gap-x-6 gap-y-5 lg:grid-cols-4"
      >
        <HistoryStat
          label="Active days"
          value={hasObservations ? formatCount(data.activeDays) : '—'}
          detail="With recorded prompts"
        />
        <HistoryStat
          label="Longest streak"
          value={longestStreak ? formatCount(longestStreak.days) : hasObservations ? '0' : '—'}
          detail={
            longestStreak
              ? `${shortDate(longestStreak.startDate)}–${shortDate(longestStreak.endDate)}`
              : 'Consecutive calendar days'
          }
        />
        <div className="flex min-w-0 flex-col items-start gap-1">
          {busiestDay ? (
            <button
              type="button"
              aria-label={`Busiest day: ${formatCount(busiestDay.count)} prompts on ${shortDate(busiestDay.date)}. Open day details`}
              aria-haspopup="dialog"
              onClick={(event) => selectDay(busiestDay.date, event.currentTarget)}
              className="rounded-[2px] text-usage-stat text-foreground underline decoration-border underline-offset-4 outline-none transition-colors hover:decoration-foreground focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
            >
              {formatCount(busiestDay.count)}
            </button>
          ) : (
            <span className="text-usage-stat text-foreground">—</span>
          )}
          <StatLabel label="Busiest day" />
          <p className="text-[11px] text-muted-foreground">
            {busiestDay ? `${shortDate(busiestDay.date)} · prompts` : 'No recorded prompts'}
          </p>
        </div>
        <HistoryStat
          label="Prompts / active day"
          value={
            summary.promptsPerActiveDay === null
              ? '—'
              : summary.promptsPerActiveDay.toLocaleString(undefined, { maximumFractionDigits: 1 })
          }
          detail="Recorded daily average"
        />
      </div>

      <ContributionGraph data={data} onSelectDay={selectDay} />
      <ProjectTimeline data={data} resolveProjectLabel={resolveProjectLabel} />

      <ActivityDetailsDialog
        bucket={details.data ?? null}
        open={selectedDate !== null}
        pending={details.isPending}
        loadError={details.isError}
        onRetry={() => void details.refetch()}
        fallbackTitle={selectedDate ? `${selectedDate} · Activity details` : undefined}
        tokens={details.data?.tokens ?? null}
        coverage={details.data?.coverage}
        onOpenChange={(open) => {
          if (!open) setSelectedDate(null)
        }}
        onRestoreFocus={() => trigger.current?.focus()}
        resolveProjectLabel={resolveProjectLabel}
      />
    </section>
  )
}

function StatLabel({ label }: { label: string }): React.JSX.Element {
  return (
    <span className="text-[11px] font-medium uppercase tracking-[0.04em] text-muted-foreground">
      {label}
    </span>
  )
}

function HistoryStat({
  label,
  value,
  detail
}: {
  label: string
  value: string
  detail: string
}): React.JSX.Element {
  return (
    <div className="flex min-w-0 flex-col items-start gap-1">
      <span className="text-usage-stat text-foreground">{value}</span>
      <StatLabel label={label} />
      <p className="text-[11px] text-muted-foreground">{detail}</p>
    </div>
  )
}
