import { useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { cn } from '@/lib/utils'
import type { ResidentTaxCategory } from '../../../../shared/ipc'

const CATEGORY_LABELS: Record<ResidentTaxCategory['key'], string> = {
  skills: 'Skills',
  agents: 'Agents',
  hooks: 'SessionStart hooks',
  mcp: 'MCP instructions',
  instructions: 'Project instructions',
  remainder: 'System + tool schemas + other unitemized context'
}

const CATEGORY_OPACITY: Record<ResidentTaxCategory['key'], number> = {
  skills: 1,
  agents: 0.82,
  hooks: 0.68,
  mcp: 0.54,
  instructions: 0.4,
  remainder: 0.24
}

function itemLabel(category: ResidentTaxCategory): string {
  if (category.key === 'remainder') return 'Not yet itemized'
  const count = category.itemCount ?? 0
  const noun =
    category.key === 'skills'
      ? 'skill'
      : category.key === 'agents'
        ? 'agent'
        : category.key === 'hooks'
          ? 'hook'
          : category.key === 'mcp'
            ? 'server block'
            : 'file'
  return `${count.toLocaleString()} ${noun}${count === 1 ? '' : 's'}`
}

export function ResidentCompositionBar({
  total,
  categories
}: {
  total: number
  categories: ResidentTaxCategory[]
}): React.JSX.Element {
  const reduceMotion = useReducedMotion() === true
  const [active, setActive] = useState<ResidentTaxCategory['key'] | null>(null)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex h-3 w-full overflow-hidden rounded-[1px] bg-muted">
        {categories
          .filter((category) => category.tokens > 0)
          .map((category, index) => {
            const opacity = CATEGORY_OPACITY[category.key]
            const dimmed = active !== null && active !== category.key
            return (
              <motion.div
                key={category.key}
                tabIndex={0}
                role="img"
                aria-label={`${CATEGORY_LABELS[category.key]}, ${category.tokens.toLocaleString()} tokens`}
                className="h-full min-w-px origin-left bg-usage-bar outline-none transition-opacity duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                style={{
                  width: `${(category.tokens / Math.max(total, 1)) * 100}%`,
                  opacity: dimmed ? opacity * 0.35 : opacity
                }}
                onMouseEnter={() => setActive(category.key)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(category.key)}
                onBlur={() => setActive(null)}
                initial={reduceMotion ? false : { scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={
                  reduceMotion
                    ? { duration: 0 }
                    : { duration: 0.3, ease: 'easeOut', delay: index * 0.05 }
                }
              />
            )
          })}
      </div>

      <div className="flex flex-col divide-y divide-border">
        {categories.map((category) => {
          const opacity = CATEGORY_OPACITY[category.key]
          return (
            <button
              key={category.key}
              type="button"
              className={cn(
                'flex items-center gap-3 rounded-sm py-2 text-left text-[13px] outline-none transition-opacity duration-150 focus-visible:ring-2 focus-visible:ring-ring',
                active !== null && active !== category.key && 'opacity-40'
              )}
              onMouseEnter={() => setActive(category.key)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(category.key)}
              onBlur={() => setActive(null)}
            >
              <span
                aria-hidden
                className="size-2 shrink-0 rounded-full bg-usage-bar"
                style={{ opacity }}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-foreground">
                  {CATEGORY_LABELS[category.key]}
                </span>
                <span className="block text-[11px] text-muted-foreground">
                  {itemLabel(category)}
                </span>
              </span>
              <span className="shrink-0 font-mono text-[12px] tabular-nums text-muted-foreground">
                {category.estimated ? '≈' : ''}
                {category.tokens.toLocaleString()} tokens
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
