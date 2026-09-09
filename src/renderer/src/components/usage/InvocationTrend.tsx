import { useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { cn } from '@/lib/utils'
import type { SkillStatsWindowKey, SkillTrendBucket } from '../../../../shared/ipc'
import { formatCount } from './chart-utils'

function parseLocalDate(value: string): Date {
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function shortLabel(bucket: SkillTrendBucket, window: SkillStatsWindowKey): string {
  if (window === '24h') {
    return new Date(bucket.key).toLocaleTimeString(undefined, { hour: 'numeric' })
  }
  return parseLocalDate(bucket.key).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric'
  })
}

function detailLabel(bucket: SkillTrendBucket, window: SkillStatsWindowKey): string {
  const date = window === '24h' ? new Date(bucket.key) : parseLocalDate(bucket.key)
  const options: Intl.DateTimeFormatOptions =
    window === '24h'
      ? { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric' }
      : { weekday: 'short', month: 'short', day: 'numeric' }
  return window === '24h'
    ? date.toLocaleString(undefined, options)
    : date.toLocaleDateString(undefined, options)
}

export function InvocationTrend({
  data,
  window
}: {
  data: SkillTrendBucket[]
  window: SkillStatsWindowKey
}): React.JSX.Element {
  const reduceMotion = useReducedMotion() === true
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const max = Math.max(1, ...data.map((bucket) => bucket.count))
  const dense = data.length > 24

  return (
    <div className="relative">
      <div
        className={cn(
          'flex h-[72px] items-end border-b border-border',
          dense ? 'gap-[3px]' : 'gap-1'
        )}
        onMouseLeave={() => setHoveredIndex(null)}
      >
        {data.map((bucket, index) => {
          const height = bucket.count === 0 ? 0 : Math.max(5, (bucket.count / max) * 100)
          const current = index === data.length - 1
          return (
            <button
              type="button"
              key={bucket.key}
              aria-label={`${detailLabel(bucket, window)}: ${bucket.count} skill invocations`}
              className="relative flex h-full flex-1 items-end outline-none"
              onMouseEnter={() => setHoveredIndex(index)}
              onFocus={() => setHoveredIndex(index)}
              onBlur={() => setHoveredIndex(null)}
            >
              <motion.span
                aria-hidden
                className={cn(
                  'block w-full rounded-[1px]',
                  current ? 'border border-usage-bar' : 'bg-usage-bar',
                  hoveredIndex !== null && hoveredIndex !== index && 'opacity-40'
                )}
                style={{ height: `${height}%`, transformOrigin: 'bottom' }}
                initial={reduceMotion ? false : { scaleY: 0 }}
                animate={{ scaleY: 1 }}
                transition={
                  reduceMotion
                    ? { duration: 0 }
                    : { duration: 0.32, ease: 'easeOut', delay: Math.min(index * 0.012, 0.3) }
                }
              />
            </button>
          )
        })}
      </div>

      <div className="mt-1 min-h-4 text-[11px] font-mono text-muted-foreground">
        {hoveredIndex !== null && data[hoveredIndex] ? (
          <span>
            {detailLabel(data[hoveredIndex], window)} · {formatCount(data[hoveredIndex].count)}{' '}
            invocation{data[hoveredIndex].count === 1 ? '' : 's'}
          </span>
        ) : (
          <div className="flex">
            {data.map((bucket, index) => {
              const interval = window === '24h' ? 6 : window === '7d' ? 1 : 10
              const show = index === 0 || index === data.length - 1 || index % interval === 0
              return (
                <span key={bucket.key} className="flex-1 text-center">
                  {show ? shortLabel(bucket, window) : ''}
                </span>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
