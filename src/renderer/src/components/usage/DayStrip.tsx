import { useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { cn } from '@/lib/utils'
import { WEEKDAY_INITIALS, WEEKDAY_LABELS } from './chart-utils'

const PLOT_HEIGHT = 72

function formatShortDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export interface DayStripDatum {
  date: string // YYYY-MM-DD, local
  value: number
  weekday: number // 0 = Sunday, server-computed — never re-parsed from `date`
  partial?: boolean
}

interface DayStripProps {
  data: DayStripDatum[]
  days: number
  formatValue: (value: number) => string
  onSelectDay?: (day: DayStripDatum, trigger: HTMLButtonElement) => void
}

// Thin full-ink bars, one per day, on a single faint baseline rule. A --surface-muted band sits
// behind every Sat/Sun column (datum.weekday, never re-parsed from the date string). Today is
// always the last bar and renders outline-only — it is a partial day.
//
// ponytail: renders one bar per day, capped in practice at ~cleanupPeriodDays (~30) by the
// transcript prune. Past ~45 bars (a user who raised retention) it should bucket `data` to ISO
// weeks — bars become weeks, the weekend band drops, labels become week-of. Deferred until a real
// >45-day window exists (docs/usage-view-ui-spec.md §C5).
export function DayStrip({
  data,
  days,
  formatValue,
  onSelectDay
}: DayStripProps): React.JSX.Element {
  const reduceMotion = useReducedMotion() === true
  const [hovered, setHovered] = useState<number | null>(null)
  const max = Math.max(1, ...data.map((d) => d.value))
  const wide = days <= 7

  return (
    <div className="relative">
      <div
        className={cn('flex items-end border-b border-border', wide ? 'gap-1.5' : 'gap-[3px]')}
        style={{ height: PLOT_HEIGHT }}
        onMouseLeave={() => setHovered(null)}
      >
        {data.map((day, index) => {
          const isToday = index === data.length - 1
          const isWeekend = day.weekday === 0 || day.weekday === 6
          const heightPct = day.value === 0 ? 0 : Math.max(4, (day.value / max) * 100)
          return (
            <div
              key={day.date}
              className={cn(
                'relative flex h-full items-end',
                wide ? 'w-8 justify-center' : 'flex-1',
                isWeekend && 'bg-muted'
              )}
              onMouseEnter={() => setHovered(index)}
            >
              {onSelectDay && (
                <button
                  type="button"
                  aria-label={`${day.date}: ${formatValue(day.value)}${day.partial ? ' · partial day' : ''}`}
                  aria-disabled={day.value === 0}
                  aria-haspopup={day.value > 0 ? 'dialog' : undefined}
                  className={cn(
                    'absolute inset-0 z-10 outline-none focus-visible:ring-1 focus-visible:ring-ring',
                    day.value > 0 ? 'cursor-pointer' : 'cursor-default'
                  )}
                  onFocus={() => setHovered(index)}
                  onBlur={() => setHovered(null)}
                  onClick={(event) => {
                    if (day.value > 0) onSelectDay(day, event.currentTarget)
                  }}
                />
              )}
              <motion.div
                className={cn(
                  'w-full rounded-[1px]',
                  wide && 'mx-auto max-w-[28px]',
                  isToday ? 'border border-usage-bar' : 'bg-usage-bar'
                )}
                style={{ transformOrigin: 'bottom' }}
                initial={reduceMotion ? false : { scaleY: 0 }}
                animate={{ scaleY: 1, height: `${heightPct}%` }}
                transition={
                  reduceMotion
                    ? { duration: 0 }
                    : { duration: 0.32, ease: 'easeOut', delay: Math.min(index * 0.012, 0.36) }
                }
              />
              {hovered === index && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-x-1/2 top-0 bottom-0 w-px -translate-x-1/2 bg-border"
                />
              )}
            </div>
          )
        })}
      </div>

      {hovered !== null && data[hovered] && (
        <div className="mt-1 text-[11px] text-muted-foreground">
          {hovered === data.length - 1 ? (
            <span className="font-mono">
              {formatShortDate(data[hovered].date)} · {formatValue(data[hovered].value)} · today, so
              far
            </span>
          ) : (
            <span className="font-mono">
              {WEEKDAY_LABELS[data[hovered].weekday]} {formatShortDate(data[hovered].date)} ·{' '}
              {formatValue(data[hovered].value)}
              {data[hovered].partial && ' · partial day'}
            </span>
          )}
        </div>
      )}

      {hovered === null && (
        <div
          className={cn(
            'mt-1 flex text-[11px] font-mono text-muted-foreground',
            wide ? 'gap-1.5' : 'gap-[3px]'
          )}
        >
          {wide
            ? data.map((day) => (
                <span key={day.date} className="w-8 shrink-0 text-center">
                  {WEEKDAY_INITIALS[day.weekday]}
                </span>
              ))
            : data.map((day, index) => {
                const show =
                  index === 0 ||
                  index === data.length - 1 ||
                  index === Math.floor(data.length / 3) ||
                  index === Math.floor((2 * data.length) / 3)
                return (
                  <span
                    key={day.date}
                    className={cn(
                      'flex-1 whitespace-nowrap text-center',
                      index === 0 && 'text-left',
                      index === data.length - 1 && 'text-right'
                    )}
                  >
                    {show ? formatShortDate(day.date) : ''}
                  </span>
                )
              })}
        </div>
      )}
    </div>
  )
}
