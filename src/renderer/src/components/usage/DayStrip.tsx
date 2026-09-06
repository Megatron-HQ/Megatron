import { useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { cn } from '@/lib/utils'
import type { ActivityDay } from '../../../../shared/ipc'
import { WEEKDAY_INITIALS } from './chart-utils'

const PLOT_HEIGHT = 72

function formatShortDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

interface DayStripProps {
  byDay: ActivityDay[]
  days: 7 | 30
}

// Thin full-ink bars, one per day, on a single faint baseline rule. A --surface-muted band sits
// behind every Sat/Sun column (byDay[].weekday, never re-parsed from the date string). Today is
// always the last bar and renders outline-only — it is a partial day.
export function DayStrip({ byDay, days }: DayStripProps): React.JSX.Element {
  const reduceMotion = useReducedMotion() === true
  const [hovered, setHovered] = useState<number | null>(null)
  const max = Math.max(1, ...byDay.map((d) => d.count))
  const wide = days === 7

  return (
    <div className="relative">
      <div
        className={cn('flex items-end border-b border-border', wide ? 'gap-1.5' : 'gap-[3px]')}
        style={{ height: PLOT_HEIGHT }}
        onMouseLeave={() => setHovered(null)}
      >
        {byDay.map((day, index) => {
          const isToday = index === byDay.length - 1
          const isWeekend = day.weekday === 0 || day.weekday === 6
          const heightPct = day.count === 0 ? 0 : Math.max(4, (day.count / max) * 100)
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

      {hovered !== null && byDay[hovered] && (
        <div className="mt-1 text-[11px] text-muted-foreground">
          <span className="font-mono">{formatShortDate(byDay[hovered].date)}</span>
          {hovered === byDay.length - 1 ? (
            <> · today, so far — {byDay[hovered].count.toLocaleString()} prompts</>
          ) : (
            <> · {byDay[hovered].count.toLocaleString()} prompts</>
          )}
        </div>
      )}

      {hovered === null && (
        <div className="mt-1 flex text-[11px] font-mono text-muted-foreground">
          {wide
            ? byDay.map((day) => (
                <span key={day.date} className="w-8 shrink-0 text-center">
                  {WEEKDAY_INITIALS[day.weekday]}
                </span>
              ))
            : byDay.map((day, index) => {
                const show =
                  index === 0 ||
                  index === byDay.length - 1 ||
                  index === Math.floor(byDay.length / 3) ||
                  index === Math.floor((2 * byDay.length) / 3)
                return (
                  <span key={day.date} className="flex-1 text-center">
                    {show ? formatShortDate(day.date) : ''}
                  </span>
                )
              })}
        </div>
      )}
    </div>
  )
}
