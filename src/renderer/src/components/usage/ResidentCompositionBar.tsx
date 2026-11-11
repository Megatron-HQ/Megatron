import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { cn } from '@/lib/utils'
import type { ContextCategory, ContextUsage } from '../../../../shared/ipc'
import { barScale, resolveDrillTarget, type DrillTarget } from './resident-drill'

type Fill = { kind: 'ink'; opacity: number; color: string } | { kind: 'buffer' } | { kind: 'free' }

const CATEGORY_COLORS: Record<string, string> = {
  skills: 'var(--entity-skills)',
  'mcp tools': 'var(--entity-mcp)',
  'mcp server instructions': 'var(--entity-mcp)',
  'memory files': 'var(--entity-memory)',
  'custom agents': 'var(--entity-agents)'
}

function categoryColor(category: ContextCategory): string | undefined {
  const key = category.name
    .trim()
    .toLowerCase()
    .replace(/\s*\(deferred\)$/, '')
  return Object.hasOwn(CATEGORY_COLORS, key) ? CATEGORY_COLORS[key] : undefined
}

// Configurable categories carry a fixed identity; system overhead retains the quiet ink ramp.
// Buffer stripes and the bare free-space track stay outside the category palette.
function fillOf(category: ContextCategory, used: ContextCategory[]): Fill {
  if (category.group === 'buffer') return { kind: 'buffer' }
  if (category.group === 'free') return { kind: 'free' }
  const color = categoryColor(category)
  if (color !== undefined) return { kind: 'ink', opacity: 1, color }
  const index = used.indexOf(category)
  return {
    kind: 'ink',
    opacity: used.length <= 1 ? 1 : 1 - (index / (used.length - 1)) * 0.7,
    color: 'var(--usage-bar)'
  }
}

function percentOfWindow(tokens: number, windowTokens: number): string {
  const percent = (tokens / Math.max(windowTokens, 1)) * 100
  return percent > 0 && percent < 0.1 ? '<0.1%' : `${percent.toFixed(1)}%`
}

// Every row carries a second line, so the ledger keeps one rhythm and says where its detail lives.
function rowDetail(category: ContextCategory, target: DrillTarget | null): string | null {
  if (target?.kind === 'section') {
    const count = target.section.rows.length
    return `${count.toLocaleString()} ${count === 1 ? 'item' : 'items'}`
  }
  if (target?.kind === 'recorded') return 'Detail from your latest session'
  if (category.group === 'buffer') return 'Reserved for auto-compaction'
  if (category.group === 'free') return 'Unused'
  if (category.group === 'deferred') return 'Loaded on demand'
  return null
}

function displayName(category: ContextCategory): string {
  return category.group === 'deferred'
    ? category.name.replace(/\s*\(deferred\)$/i, '')
    : category.name
}

export function ResidentCompositionBar({
  usage,
  onDrill
}: {
  usage: ContextUsage
  onDrill: (category: ContextCategory, trigger: HTMLElement) => void
}): React.JSX.Element {
  const reduceMotion = useReducedMotion() === true
  const [active, setActive] = useState<string | null>(null)
  const used = usage.categories.filter((category) => category.group === 'used')
  // Bar order mirrors how the window fills: what's loaded, then the reserve, then what's left.
  const inWindow = [
    ...used,
    ...usage.categories.filter((category) => category.group === 'buffer'),
    ...usage.categories.filter((category) => category.group === 'free')
  ]
  const deferred = usage.categories.filter((category) => category.group === 'deferred')
  const { scaleTokens, freeTokens } = barScale(usage)
  const drawnTokens = (category: ContextCategory): number =>
    category.group === 'free' ? freeTokens : category.tokens
  const highlight = (
    name: string
  ): Record<'onMouseEnter' | 'onMouseLeave' | 'onFocus' | 'onBlur', () => void> => ({
    onMouseEnter: () => setActive(name),
    onMouseLeave: () => setActive(null),
    onFocus: () => setActive(name),
    onBlur: () => setActive(null)
  })

  const ledgerRow = (category: ContextCategory): React.JSX.Element => {
    const fill = category.group === 'deferred' ? null : fillOf(category, used)
    const target = resolveDrillTarget(usage, category)
    const detail = rowDetail(category, target)
    const className = cn(
      'flex w-full items-center gap-3 rounded-sm py-2 text-left text-[13px] outline-none transition-opacity duration-150 focus-visible:ring-2 focus-visible:ring-ring',
      active !== null && active !== category.name && 'opacity-40'
    )
    const content = (
      <>
        <span
          aria-hidden
          className={cn(
            'size-2 shrink-0 rounded-full',
            fill === null && 'border border-usage-bar-quiet',
            fill?.kind === 'buffer' && 'usage-fill-unrecorded border border-usage-bar-quiet',
            fill?.kind === 'free' && 'border border-usage-bar-quiet bg-muted'
          )}
          style={
            fill?.kind === 'ink'
              ? { backgroundColor: fill.color, opacity: fill.opacity }
              : fill === null
                ? { borderColor: categoryColor(category) }
                : undefined
          }
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-foreground">{displayName(category)}</span>
          {detail !== null && (
            <span className="block truncate text-[11px] text-muted-foreground">{detail}</span>
          )}
        </span>
        <span className="shrink-0 font-mono text-[12px] tabular-nums text-muted-foreground">
          {category.display} tokens
          {category.group !== 'deferred' && (
            <span className="ml-2 inline-block w-12 text-right">
              {percentOfWindow(category.tokens, usage.windowTokens)}
            </span>
          )}
        </span>
        <ChevronRight
          aria-hidden
          className={cn('size-3.5 shrink-0 text-muted-foreground', target === null && 'invisible')}
        />
      </>
    )
    return target === null ? (
      <div key={category.name} tabIndex={0} className={className} {...highlight(category.name)}>
        {content}
      </div>
    ) : (
      <button
        key={category.name}
        type="button"
        aria-haspopup="dialog"
        className={className}
        onClick={(event) => onDrill(category, event.currentTarget)}
        {...highlight(category.name)}
      >
        {content}
      </button>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <div className="flex h-3 w-full overflow-hidden rounded-[1px] bg-muted">
          {inWindow
            .filter((category) => drawnTokens(category) > 0)
            .map((category, index) => {
              const fill = fillOf(category, used)
              const dimmed = active !== null && active !== category.name
              const opacity = fill.kind === 'ink' ? fill.opacity : 1
              return (
                <motion.div
                  key={category.name}
                  tabIndex={0}
                  role="img"
                  aria-label={`${category.name}, ${category.display} tokens, ${percentOfWindow(category.tokens, usage.windowTokens)} of the context window`}
                  className={cn(
                    'h-full min-w-px origin-left outline-none transition-opacity duration-150 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
                    fill.kind === 'buffer' && 'usage-fill-unrecorded'
                  )}
                  style={{
                    width: `${(drawnTokens(category) / Math.max(scaleTokens, 1)) * 100}%`,
                    backgroundColor: fill.kind === 'ink' ? fill.color : undefined,
                    opacity: dimmed ? opacity * 0.35 : opacity
                  }}
                  {...highlight(category.name)}
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
        {scaleTokens < usage.windowTokens && (
          <span className="self-end font-mono text-[11px] tabular-nums text-muted-foreground">
            Bar shows the first {Math.round(scaleTokens / 1000)}K of{' '}
            {usage.windowDisplay.toUpperCase()}
          </span>
        )}
      </div>

      <div className="flex flex-col divide-y divide-border">{inWindow.map(ledgerRow)}</div>

      {deferred.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-medium uppercase tracking-[0.04em] text-muted-foreground">
            Deferred, not loaded
          </span>
          <div className="flex flex-col divide-y divide-border">{deferred.map(ledgerRow)}</div>
        </div>
      )}
    </div>
  )
}
