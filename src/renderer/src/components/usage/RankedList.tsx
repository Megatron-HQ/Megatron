import { useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const TOP_N = 8

export interface RankedItem {
  label: string // display name (basename)
  value: number
  fullLabel: string // full string shown on hover
}

interface RankedListProps {
  items: RankedItem[] // pre-sorted, descending by value
  formatValue: (value: number) => string
  noun: string // plural, for the disclosure row ("projects")
}

function percentLabel(value: number, total: number): string {
  if (total <= 0 || value <= 0) return '0%'
  const pct = (value / total) * 100
  return pct < 1 ? '<1%' : `${Math.round(pct)}%`
}

// A ranked table with an ambient left-anchored ink row-fill and NO track — replaces
// <ProjectBars>. The old --surface-muted track read as a progress bar and left empty rails on a
// skewed distribution. The fill is a *tinted row*, not a bar: it renders at final width (no
// grow), deepens one notch on hover. Two columns only. Monochrome — model color never bleeds
// here (docs/usage-view-ui-spec.md §C4).
export function RankedList({ items, formatValue, noun }: RankedListProps): React.JSX.Element {
  const reduceMotion = useReducedMotion() === true
  const [expanded, setExpanded] = useState(false)

  const total = items.reduce((sum, item) => sum + item.value, 0)
  const head = items.slice(0, TOP_N)
  const rest = items.slice(TOP_N)
  const restTotal = rest.reduce((sum, item) => sum + item.value, 0)

  const row = (item: RankedItem, index: number): React.JSX.Element => {
    const pct = total > 0 ? (item.value / total) * 100 : 0
    return (
      <motion.div
        key={item.fullLabel}
        className="group relative flex h-7 items-center border-b border-border last:border-b-0"
        initial={reduceMotion ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={
          reduceMotion ? { duration: 0 } : { duration: 0.2, delay: Math.min(index * 0.02, 0.2) }
        }
      >
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 bg-usage-bar/[0.07] transition-colors duration-150 group-hover:bg-usage-bar/[0.11] dark:bg-usage-bar/[0.12] dark:group-hover:bg-usage-bar/[0.17]"
          style={{ width: `${pct}%`, minWidth: item.value > 0 ? 2 : undefined }}
        />
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="relative flex-1 truncate pr-3 text-[13px]">{item.label}</span>
          </TooltipTrigger>
          <TooltipContent>{item.fullLabel}</TooltipContent>
        </Tooltip>
        <span className="relative flex w-[110px] shrink-0 justify-end gap-2 font-mono text-[12px] tabular-nums text-muted-foreground">
          <span>{formatValue(item.value)}</span>
          <span className="w-8 text-right">{percentLabel(item.value, total)}</span>
        </span>
      </motion.div>
    )
  }

  return (
    <div className="flex flex-col">
      {head.map(row)}

      <AnimatePresence initial={false}>
        {expanded && rest.length > 0 && (
          <motion.div
            className="overflow-hidden"
            initial={reduceMotion ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
          >
            {rest.map((item, i) => row(item, TOP_N + i))}
          </motion.div>
        )}
      </AnimatePresence>

      {rest.length > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="mt-1 self-start text-[11px] font-medium uppercase tracking-[0.04em] text-muted-foreground hover:text-foreground"
        >
          {expanded ? 'Show fewer' : `+ ${rest.length} more ${noun} · ${formatValue(restTotal)}`}
        </button>
      )}
    </div>
  )
}
