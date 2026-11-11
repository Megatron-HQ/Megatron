import { useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { TextLink } from '@/components/TextLink'
import { ProjectName } from '@/components/ProjectName'
import { percentLabel } from './share-bars'

const TOP_N = 8

export interface RankedItem {
  label: string // display name
  value: number
  fullLabel: string // full string shown on hover
  onSelect?: () => void
  actionLabel?: string
  swatch?: string // CSS color — model lists only (§C4); the row fill stays monochrome
  project?: boolean // label is a project name; its disambiguating parent folders give way first
}

interface RankedListProps {
  totalValue?: number
  expanded?: boolean
  onExpandedChange?: (expanded: boolean) => void
  hideDisclosure?: boolean
  items: RankedItem[] // pre-sorted: descending by value, or family-grouped for model lists
  formatValue: (value: number) => string
  formatExactValue?: (value: number) => string
  noun: string // plural, for the disclosure row ("projects")
}

// A ranked table with an ambient left-anchored ink row-fill and NO track — replaces
// <ProjectBars>. The old --surface-muted track read as a progress bar and left empty rails on a
// skewed distribution. The fill is a *tinted row*, not a bar: it renders at final width (no
// grow), deepens one notch on hover. Two columns only. Monochrome — model color reaches here only
// as an optional label swatch, never the fill (DESIGN.md, Monochrome-Chart-Ink Rule).
export function RankedList({
  items,
  formatValue,
  formatExactValue,
  noun,
  totalValue,
  expanded: controlledExpanded,
  onExpandedChange,
  hideDisclosure
}: RankedListProps): React.JSX.Element {
  const reduceMotion = useReducedMotion() === true
  const [localExpanded, setLocalExpanded] = useState(false)
  const expanded = controlledExpanded ?? localExpanded
  const setExpanded = onExpandedChange ?? setLocalExpanded

  const total = totalValue ?? items.reduce((sum, item) => sum + item.value, 0)
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
        {item.swatch && (
          <span
            aria-hidden
            className="relative mr-1.5 size-2 shrink-0 rounded-full"
            style={{ backgroundColor: item.swatch }}
          />
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            {item.onSelect ? (
              <TextLink
                onClick={item.onSelect}
                aria-label={item.actionLabel}
                className="min-w-0 flex-1 truncate pr-3 text-left text-[13px]"
              >
                {item.project ? <ProjectName label={item.label} /> : item.label}
              </TextLink>
            ) : item.project ? (
              <span className="relative flex min-w-0 flex-1 pr-3 text-[13px]">
                <ProjectName label={item.label} />
              </span>
            ) : (
              <span className="relative flex-1 truncate pr-3 text-[13px]">{item.label}</span>
            )}
          </TooltipTrigger>
          <TooltipContent className="whitespace-pre-line">{item.fullLabel}</TooltipContent>
        </Tooltip>
        <span className="relative flex w-[110px] shrink-0 justify-end gap-2 font-mono text-[12px] tabular-nums text-muted-foreground">
          {formatExactValue ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  tabIndex={0}
                  aria-label={formatExactValue(item.value)}
                  className="rounded-[2px] outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  {formatValue(item.value)}
                </span>
              </TooltipTrigger>
              <TooltipContent>{formatExactValue(item.value)}</TooltipContent>
            </Tooltip>
          ) : (
            <span>{formatValue(item.value)}</span>
          )}
          <span className="w-8 text-right">{percentLabel(item.value, total)}</span>
        </span>
      </motion.div>
    )
  }

  const disclosureButton = (
    <button
      type="button"
      onClick={() => setExpanded(!expanded)}
      className="mt-1 self-start text-[11px] font-medium uppercase tracking-[0.04em] text-muted-foreground hover:text-foreground"
      aria-label={
        formatExactValue
          ? expanded
            ? 'Show fewer'
            : `Show ${rest.length} more ${noun}, ${formatExactValue(restTotal)}`
          : undefined
      }
    >
      {expanded ? 'Show fewer' : `+ ${rest.length} more ${noun} · ${formatValue(restTotal)}`}
    </button>
  )

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

      {!hideDisclosure &&
        rest.length > 0 &&
        (formatExactValue ? (
          <Tooltip>
            <TooltipTrigger asChild>{disclosureButton}</TooltipTrigger>
            <TooltipContent>
              {formatExactValue(restTotal)} across {rest.length} more {noun}
            </TooltipContent>
          </Tooltip>
        ) : (
          disclosureButton
        ))}
    </div>
  )
}
