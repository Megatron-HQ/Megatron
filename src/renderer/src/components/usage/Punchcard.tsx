import { useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { cn } from '@/lib/utils'
import { WEEKDAY_DISPLAY_ORDER, WEEKDAY_LABELS, quantileOpacity } from './chart-utils'

const WEEKDAY_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const HOUR_TICKS = [0, 6, 12, 18]

function hour12(h: number): string {
  const base = ((h + 11) % 12) + 1
  return `${base}${h < 12 ? 'am' : 'pm'}`
}

interface PunchcardProps {
  byHourWeekday: number[][]
  byHour: number[]
  byWeekday: number[]
}

// 7×24 grid, Mon-first. Monochrome quantile-opacity intensity (not linear) so the peaks don't
// wash the rest out. Marginal bars are the matrix row/col sums — honest bar length, no
// distortion. byHour / byWeekday come pre-summed on the contract; they equal those sums.
export function Punchcard({ byHourWeekday, byHour, byWeekday }: PunchcardProps): React.JSX.Element {
  const reduceMotion = useReducedMotion() === true
  const [hover, setHover] = useState<{ wd: number; hr: number } | null>(null)
  const [hoverWeekday, setHoverWeekday] = useState<number | null>(null)

  const opacityFor = quantileOpacity(byHourWeekday.flat())
  const maxHour = Math.max(1, ...byHour)
  const maxWeekday = Math.max(1, ...byWeekday)

  return (
    <div className="flex flex-col gap-1 text-[11px] text-muted-foreground">
      {/* top edge: per-hour totals */}
      <div className="flex items-end gap-1">
        <div className="w-9 shrink-0" />
        <div className="flex h-6 flex-1 items-end gap-px">
          {byHour.map((count, hr) => (
            <div
              key={hr}
              className={cn(
                'flex-1 rounded-[1px] bg-usage-bar transition-opacity',
                hover && hover.hr !== hr && 'opacity-30'
              )}
              style={{ height: `${Math.max(count === 0 ? 0 : 8, (count / maxHour) * 100)}%` }}
            />
          ))}
        </div>
        <div className="w-12 shrink-0" />
      </div>

      {/* grid rows, Mon → Sun */}
      {WEEKDAY_DISPLAY_ORDER.map((wd, displayRow) => (
        <div key={wd} className="flex items-center gap-1">
          <div
            className={cn(
              'w-9 shrink-0 pr-2 text-right transition-colors',
              hover?.wd === wd && 'text-foreground'
            )}
          >
            {WEEKDAY_LABELS[wd]}
          </div>
          <div
            className="grid flex-1 gap-px rounded-[2px] bg-border p-px"
            style={{ gridTemplateColumns: 'repeat(24, minmax(0, 1fr))' }}
          >
            {byHourWeekday[wd].map((count, hr) => {
              const crosshair = hover && (hover.wd === wd || hover.hr === hr)
              const active = hover?.wd === wd && hover?.hr === hr
              return (
                <motion.button
                  type="button"
                  key={hr}
                  aria-label={`${WEEKDAY_FULL[wd]} ${hour12(hr)}: ${count} prompts`}
                  onMouseEnter={() => setHover({ wd, hr })}
                  onMouseLeave={() => setHover(null)}
                  className={cn(
                    'aspect-square rounded-[2px] outline-none',
                    active && 'ring-1 ring-usage-bar',
                    crosshair && !active && 'ring-1 ring-border'
                  )}
                  style={{
                    backgroundColor:
                      count > 0
                        ? `color-mix(in srgb, var(--usage-bar) ${opacityFor(count) * 100}%, transparent)`
                        : 'var(--background)'
                  }}
                  initial={reduceMotion ? false : { opacity: 0, scale: 0.6 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={
                    reduceMotion
                      ? { duration: 0 }
                      : {
                          duration: 0.24,
                          ease: 'easeOut',
                          delay: Math.min((displayRow + hr) * 0.008, 0.4)
                        }
                  }
                />
              )
            })}
          </div>
          {/* right edge: per-weekday total */}
          <div
            className="flex w-12 shrink-0 items-center pl-1"
            onMouseEnter={() => setHoverWeekday(wd)}
            onMouseLeave={() => setHoverWeekday(null)}
          >
            <div
              className={cn(
                'h-1.5 rounded-[1px] bg-usage-bar transition-opacity',
                hoverWeekday !== null && hoverWeekday !== wd && 'opacity-30'
              )}
              style={{
                width: `${Math.max(byWeekday[wd] === 0 ? 0 : 10, (byWeekday[wd] / maxWeekday) * 100)}%`
              }}
            />
          </div>
        </div>
      ))}

      {/* bottom edge: hour ticks */}
      <div className="flex gap-1">
        <div className="w-9 shrink-0" />
        <div className="relative h-4 flex-1">
          {HOUR_TICKS.map((h) => (
            <span key={h} className="absolute font-mono" style={{ left: `${(h / 24) * 100}%` }}>
              {h}
            </span>
          ))}
        </div>
        <div className="w-12 shrink-0" />
      </div>

      <div className="min-h-4 pl-10">
        {hover && (
          <span>
            {WEEKDAY_FULL[hover.wd]}s, {hour12(hover.hr)}–{hour12((hover.hr + 1) % 24)} ·{' '}
            {byHourWeekday[hover.wd][hover.hr].toLocaleString()} prompts
          </span>
        )}
      </div>
    </div>
  )
}
