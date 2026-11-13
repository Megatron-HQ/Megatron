import { useMemo, useRef, useState } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { ContributionDay, UsageCalendar } from '../../../../shared/ipc'
import { formatCount } from './chart-utils'
import { formatExactTokenCount, formatTokenCount } from '../../../../shared/token-format'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAYS_PER_WEEK = 7
const ENTER_STAGGER_MS = 2
const MAX_ENTER_DELAY_MS = 80
const calendarDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: 'long',
  day: 'numeric',
  year: 'numeric'
})
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

function dayLabel(day: ContributionDay, date: string): string {
  if (day.coverage === 'future') return `${date} · Future date`
  if (day.coverage === 'unavailable') return `${date} · Prompt history unavailable`
  return `${date} · ${formatCount(day.count)} recorded ${day.count === 1 ? 'prompt' : 'prompts'}${day.coverage === 'partial' ? ' · Partial history' : ''}`
}

export function ContributionGraph({
  data,
  onSelectDay
}: {
  data: UsageCalendar
  onSelectDay: (date: string, trigger: HTMLButtonElement) => void
}): React.JSX.Element {
  const [focusedDate, setFocusedDate] = useState<string | null>(null)
  const buttons = useRef(new Map<string, HTMLButtonElement>())
  const labelledDays = useMemo(
    () =>
      data.days.map((day, index) => ({
        day,
        index,
        dateLabel: calendarDateFormatter.format(new Date(`${day.date}T00:00:00`))
      })),
    [data.days]
  )
  const { year } = data
  const firstWeekday = data.days[0].weekday
  const columns = Math.ceil((firstWeekday + data.days.length) / DAYS_PER_WEEK)
  const weeks = useMemo(() => {
    const cells = [...Array.from({ length: firstWeekday }, () => null), ...labelledDays]
    return Array.from({ length: columns }, (_, index) =>
      cells.slice(index * DAYS_PER_WEEK, (index + 1) * DAYS_PER_WEEK)
    )
  }, [columns, firstWeekday, labelledDays])
  const today = new Date().toLocaleDateString('en-CA')
  const availableDays = data.days.filter((day) => day.coverage !== 'future')
  const tabDate = availableDays.some((day) => day.date === focusedDate)
    ? focusedDate
    : availableDays.at(-1)?.date

  return (
    <section
      aria-label="Contribution graph"
      className="flex flex-col gap-3 border-y border-border py-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div>
          <h2 className="text-[13px] font-semibold">Contributions</h2>
          <p className="mt-1 text-[12px] text-muted-foreground">
            {formatCount(data.prompts)} recorded prompts · {formatCount(data.activeDays)} active
            days in {year}
          </p>
        </div>
      </div>
      <>
        <div className="flex min-w-0 gap-2">
          <div aria-hidden className="relative w-6 shrink-0 text-[9px] text-muted-foreground">
            <div className="absolute inset-x-0 top-4 bottom-0 grid grid-rows-7 items-center gap-[2px] leading-none">
              <span />
              <span>Mon</span>
              <span />
              <span>Wed</span>
              <span />
              <span>Fri</span>
              <span />
            </div>
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
                      gridColumn: `${Math.floor((first + firstWeekday) / DAYS_PER_WEEK) + 1} / span 3`,
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
              className="grid gap-[2px]"
              style={{ gridTemplateColumns: `repeat(${columns},minmax(0,1fr))` }}
            >
              {weeks.map((week, weekIndex) => (
                <div
                  key={weekIndex}
                  className="history-calendar-week grid min-w-0 grid-rows-7 gap-[2px]"
                  style={{
                    animationDelay: `${Math.min(weekIndex * ENTER_STAGGER_MS, MAX_ENTER_DELAY_MS)}ms`
                  }}
                >
                  {week.map((cell, rowIndex) => {
                    if (cell === null) return <span key={`padding-${rowIndex}`} />
                    const { day, dateLabel, index } = cell
                    if (day.coverage === 'future')
                      return (
                        <span
                          key={day.date}
                          className="aspect-square"
                          aria-label={dayLabel(day, dateLabel)}
                        />
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
                            aria-label={dayLabel(day, dateLabel)}
                            aria-disabled={!canOpen}
                            aria-haspopup={canOpen ? 'dialog' : undefined}
                            onFocus={() => setFocusedDate(day.date)}
                            onKeyDown={(event) => {
                              const offset = {
                                ArrowLeft: -DAYS_PER_WEEK,
                                ArrowRight: DAYS_PER_WEEK,
                                ArrowUp: -1,
                                ArrowDown: 1
                              }[event.key]
                              if (offset === undefined) return
                              event.preventDefault()
                              const next = data.days[index + offset]
                              if (next) buttons.current.get(next.date)?.focus()
                            }}
                            onClick={(event) => {
                              if (canOpen) onSelectDay(day.date, event.currentTarget)
                            }}
                            className={cn(
                              'aspect-square min-w-0 rounded-[2px] border border-border/60 outline-none hover:ring-1 hover:ring-usage-bar focus-visible:ring-2 focus-visible:ring-ring',
                              day.coverage === 'unavailable' && 'border-dashed',
                              !canOpen && 'cursor-default',
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
                          <p>{dateLabel}</p>
                          <p className="mt-1">
                            Prompts:{' '}
                            {day.coverage === 'unavailable'
                              ? 'Unavailable'
                              : formatCount(day.count)}
                            {day.coverage === 'partial' && ' · Partial history'}
                          </p>
                          <p className="mt-1 opacity-75">
                            Tokens:{' '}
                            {day.tokens
                              ? `${formatTokenCount(day.tokens.total)} estimated`
                              : 'Unavailable'}
                          </p>
                          {day.tokens && (
                            <p className="mt-1 text-[11px] opacity-75">
                              {formatExactTokenCount(day.tokens.total)} exact tokens
                            </p>
                          )}
                        </TooltipContent>
                      </Tooltip>
                    )
                  })}
                </div>
              ))}
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
    </section>
  )
}
