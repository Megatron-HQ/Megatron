import { useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { useProjectLabel } from '@/lib/use-project-label'
import { createUsageProjectLabelResolver } from '@/lib/usage-project-label'
import type { ContributionDay } from '../../../../shared/ipc'
import { ActivityDetailsDialog } from './ActivityDetailsDialog'
import { formatCount } from './chart-utils'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const LEVELS = [
  'var(--muted)',
  'var(--contribution-1)',
  'var(--contribution-2)',
  'var(--contribution-3)',
  'var(--contribution-4)'
]

function intensity(day: ContributionDay, thresholds: number[]): number {
  return day.count <= 0 ? 0 : 1 + thresholds.filter((threshold) => day.count > threshold).length
}

function dayLabel(day: ContributionDay): string {
  const date = new Date(`${day.date}T00:00:00`).toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  })
  if (day.coverage === 'future') return `${date} · Future date`
  if (day.coverage === 'unavailable') return `${date} · Prompt history unavailable`
  return `${date} · ${formatCount(day.count)} recorded ${day.count === 1 ? 'prompt' : 'prompts'}${day.coverage === 'partial' ? ' · Partial history' : ''}`
}

export function ContributionGraph({
  year,
  onYearChange
}: {
  year: number
  onYearChange: (year: number) => void
}): React.JSX.Element {
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [focusedDate, setFocusedDate] = useState<string | null>(null)
  const trigger = useRef<HTMLButtonElement | null>(null)
  const buttons = useRef(new Map<string, HTMLButtonElement>())
  const calendar = useQuery({
    queryKey: ['usage', 'calendar', year],
    queryFn: () => window.api.getUsageCalendar(year)
  })
  const details = useQuery({
    queryKey: ['usage', 'day', selectedDate],
    queryFn: () => window.api.getUsageDay(selectedDate!),
    enabled: selectedDate !== null
  })
  const resolveHierarchy = useProjectLabel()
  const resolveProjectLabel = useMemo(
    () =>
      createUsageProjectLabelResolver(
        (details.data?.byProject ?? []).map((project) => project.project),
        resolveHierarchy
      ),
    [details.data, resolveHierarchy]
  )
  const data = calendar.data
  const firstWeekday = data?.days[0].weekday ?? 0
  const columns = Math.ceil((firstWeekday + (data?.days.length ?? 365)) / 7)
  const today = new Date().toLocaleDateString('en-CA')
  const availableDays = data?.days.filter((day) => day.coverage !== 'future') ?? []
  const tabDate = availableDays.some((day) => day.date === focusedDate)
    ? focusedDate
    : availableDays.at(-1)?.date

  return (
    <section
      aria-label="Contribution graph"
      className="flex flex-col gap-3 border-b border-border py-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div>
          <h2 className="text-[13px] font-semibold">Contributions</h2>
          {data && (
            <p className="mt-1 text-[12px] text-muted-foreground">
              {formatCount(data.prompts)} recorded prompts · {formatCount(data.activeDays)} active
              days in {year}
            </p>
          )}
        </div>
        <nav
          aria-label="Contribution year"
          className="flex max-w-full gap-1 overflow-x-auto rounded-md border border-border p-0.5"
        >
          {(data?.years ?? [year]).map((value) => (
            <button
              key={value}
              type="button"
              aria-current={year === value ? 'date' : undefined}
              onClick={() => {
                setFocusedDate(null)
                onYearChange(value)
              }}
              className={cn(
                'rounded-sm px-2 py-1 font-mono text-[12px] outline-none focus-visible:ring-1 focus-visible:ring-ring',
                year === value
                  ? 'bg-muted text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {value}
            </button>
          ))}
        </nav>
      </div>
      {calendar.isPending ? (
        <Skeleton className="h-[110px] w-full" />
      ) : calendar.isError ? (
        <div role="alert" className="text-[12px] text-muted-foreground">
          Could not load contribution history.{' '}
          <button
            type="button"
            onClick={() => void calendar.refetch()}
            className="underline underline-offset-2"
          >
            Retry
          </button>
        </div>
      ) : data ? (
        <>
          <div className="flex min-w-0 gap-2">
            <div
              aria-hidden
              className="grid w-6 shrink-0 grid-rows-[16px_repeat(7,minmax(0,1fr))] gap-[2px] text-[9px] text-muted-foreground"
            >
              <span />
              <span />
              <span>Mon</span>
              <span />
              <span>Wed</span>
              <span />
              <span>Fri</span>
              <span />
            </div>
            <div className="min-w-0 flex-1">
              <div
                aria-hidden
                className="mb-1 grid h-3 text-[9px] text-muted-foreground"
                style={{ gridTemplateColumns: `repeat(${columns},minmax(0,1fr))` }}
              >
                {MONTHS.map((month, index) => {
                  const first = data.days.findIndex(
                    (day) => day.date.slice(5) === `${String(index + 1).padStart(2, '0')}-01`
                  )
                  return (
                    <span
                      key={month}
                      style={{
                        gridColumn: `${Math.floor((first + firstWeekday) / 7) + 1} / span 3`,
                        gridRow: 1
                      }}
                    >
                      {month}
                    </span>
                  )
                })}
              </div>
              <div
                role="group"
                aria-label={`Daily activity calendar for ${year}`}
                className="grid grid-flow-col grid-rows-7 gap-[2px]"
                style={{ gridTemplateColumns: `repeat(${columns},minmax(0,1fr))` }}
              >
                {Array.from({ length: firstWeekday }, (_, index) => (
                  <span key={`padding-${index}`} />
                ))}
                {data.days.map((day, index) => {
                  if (day.coverage === 'future')
                    return (
                      <span key={day.date} className="aspect-square" aria-label={dayLabel(day)} />
                    )
                  const canOpen = day.coverage !== 'unavailable' || day.tokens !== null
                  return (
                    <Tooltip key={day.date}>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          ref={(element) => {
                            if (element) buttons.current.set(day.date, element)
                            else buttons.current.delete(day.date)
                          }}
                          tabIndex={day.date === tabDate ? 0 : -1}
                          aria-label={dayLabel(day)}
                          aria-disabled={!canOpen}
                          aria-haspopup={canOpen ? 'dialog' : undefined}
                          onFocus={() => setFocusedDate(day.date)}
                          onKeyDown={(event) => {
                            const offset = {
                              ArrowLeft: -7,
                              ArrowRight: 7,
                              ArrowUp: -1,
                              ArrowDown: 1
                            }[event.key]
                            if (offset === undefined) return
                            event.preventDefault()
                            const next = data.days[index + offset]
                            if (next) buttons.current.get(next.date)?.focus()
                          }}
                          onClick={(event) => {
                            if (canOpen) {
                              trigger.current = event.currentTarget
                              setSelectedDate(day.date)
                            }
                          }}
                          className={cn(
                            'aspect-square min-w-0 rounded-[2px] border border-border/60 outline-none hover:ring-1 hover:ring-usage-bar focus-visible:ring-2 focus-visible:ring-ring',
                            !canOpen && 'cursor-default border-dashed',
                            day.date === today && 'ring-1 ring-usage-bar'
                          )}
                          style={{
                            backgroundColor:
                              day.coverage === 'unavailable'
                                ? 'transparent'
                                : LEVELS[intensity(day, data.thresholds)]
                          }}
                        />
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>{dayLabel(day)}</p>
                        <p className="mt-1 opacity-75">
                          {day.tokens
                            ? `${formatCount(day.tokens.total)} estimated tokens`
                            : 'Token data unavailable'}
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  )
                })}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-muted-foreground">
            <span>Prompts per day · local time · dashed squares: unavailable history</span>
            <div
              className="flex items-center gap-1"
              aria-label="Contribution intensity: less to more prompts"
            >
              <span className="mr-1">Less</span>
              {LEVELS.map((fill, index) => (
                <span
                  key={fill}
                  className="size-2.5 rounded-[2px] border border-border/60"
                  style={{ backgroundColor: fill }}
                  title={
                    index === 0
                      ? 'No recorded prompts'
                      : index === 4
                        ? `More than ${data.thresholds[2]} prompts`
                        : `Up to ${data.thresholds[index - 1]} prompts`
                  }
                />
              ))}
              <span className="ml-1">More</span>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            History is kept on this computer after each scan. Older deleted activity cannot be
            recovered; partially observed days may be incomplete.
          </p>
        </>
      ) : null}
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
