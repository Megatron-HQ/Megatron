import { useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import type { CostHour } from '../../../../shared/ipc'
import { formatUsd } from './chart-utils'

const PLOT_HEIGHT = 72
const HOUR_LABEL_INTERVAL = 6

function hourLabel(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function bucketLabel(hour: CostHour): string {
  const start = new Date(hour.startAt).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
  return `${start}–${hourLabel(hour.endAt)} · ${formatUsd(hour.costUsd, { cents: true })}`
}

export function CostHourStrip({
  data,
  onSelectHour
}: {
  data: CostHour[]
  onSelectHour: (hour: CostHour, trigger: HTMLButtonElement) => void
}): React.JSX.Element {
  const reduceMotion = useReducedMotion() === true
  const [hovered, setHovered] = useState<number | null>(null)
  const maximum = Math.max(1, ...data.map((hour) => hour.costUsd))
  return (
    <div>
      <div
        className="flex items-end gap-1 border-b border-border"
        style={{ height: PLOT_HEIGHT }}
        onMouseLeave={() => setHovered(null)}
      >
        {data.map((hour, index) => (
          <button
            type="button"
            key={index}
            aria-label={bucketLabel(hour)}
            aria-disabled={hour.costUsd === 0}
            aria-haspopup={hour.costUsd > 0 ? 'dialog' : undefined}
            className={`relative flex h-full min-w-0 flex-1 items-end outline-none focus-visible:ring-1 focus-visible:ring-ring ${hour.costUsd > 0 ? 'cursor-pointer' : 'cursor-default'}`}
            onMouseEnter={() => setHovered(index)}
            onFocus={() => setHovered(index)}
            onBlur={() => setHovered(null)}
            onClick={(event) => {
              if (hour.costUsd > 0) onSelectHour(hour, event.currentTarget)
            }}
          >
            <motion.span
              aria-hidden
              className="block w-full rounded-[1px] bg-usage-bar"
              style={{
                height: `${hour.costUsd === 0 ? 0 : Math.max(4, (hour.costUsd / maximum) * 100)}%`,
                transformOrigin: 'bottom'
              }}
              initial={reduceMotion ? false : { scaleY: 0 }}
              animate={{ scaleY: 1 }}
              transition={
                reduceMotion
                  ? { duration: 0 }
                  : { duration: 0.32, delay: index * 0.012, ease: 'easeOut' }
              }
            />
            {hovered === index && (
              <span
                aria-hidden
                className="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-border"
              />
            )}
          </button>
        ))}
      </div>
      <div className="mt-1 min-h-4 text-[11px] font-mono text-muted-foreground">
        {hovered !== null && data[hovered] ? (
          bucketLabel(data[hovered])
        ) : (
          <div className="flex gap-1">
            {data.map((hour, index) => (
              <span key={hour.startAt} className="min-w-0 flex-1 text-center">
                {index % HOUR_LABEL_INTERVAL === 0 || index === data.length - 1
                  ? hourLabel(hour.startAt)
                  : ''}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
