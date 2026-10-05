import { motion, useReducedMotion } from 'motion/react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export interface SegmentCard {
  title: string
  subtitle?: string // shown on the card only, never read out
  lines: string[]
}

export interface Segment<K extends string> {
  key: K
  fraction: number // of the bar's width
  fill?: string
  className?: string
  dimmed: boolean
  card: SegmentCard
  // Off = mouse-only and hidden from screen readers, for a bar whose figures another bar's
  // segments already announce (Models' Output under Turns).
  focusable: boolean
  onSelect?: () => void
  pressed?: boolean
  order?: number // enter-stagger index; omit for a segment that appears at its final width
}

const SEGMENT_GAP_PX = 2
const SEGMENT_MIN_WIDTH_PX = 3
const FOCUS_RING =
  'outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset'

// The segment row shared by `ShareBars` and the Models effort bars (docs/usage-view-ui-spec.md,
// "Effort bar and bar tooltips"). `hit="bar"` makes the 8px bar its own target, so the share bars
// keep their geometry; `hit="row"` wraps it in an h-6 target so thin effort segments in a table
// row stay easy to hit.
export function SegmentBar<K extends string>({
  segments,
  hit,
  onActivate,
  onDeactivate
}: {
  segments: Segment<K>[]
  hit: 'bar' | 'row'
  onActivate: (key: K) => void // hover or focus
  onDeactivate: () => void
}): React.JSX.Element {
  const reduceMotion = useReducedMotion() === true
  const gapWidth = Math.max(segments.length - 1, 0) * SEGMENT_GAP_PX

  return (
    <div
      className={cn(
        'flex w-full min-w-0',
        hit === 'bar' ? 'h-2 overflow-hidden rounded-[1px]' : 'h-6'
      )}
    >
      {segments.map((segment, index) => {
        const animated = segment.order !== undefined && !reduceMotion
        const visualClass = cn(
          'transition-opacity duration-150',
          segment.dimmed && 'opacity-40',
          segment.className
        )
        const triggerProps = {
          className: cn(
            'h-full shrink',
            FOCUS_RING,
            hit === 'bar' ? visualClass : 'flex items-center'
          ),
          style: {
            // Reserve paper gaps before dividing the bar; flex shrinking absorbs the
            // extra space needed by tiny segments' visibility floor.
            width: `calc((100% - ${gapWidth}px) * ${segment.fraction})`,
            minWidth: SEGMENT_MIN_WIDTH_PX,
            marginLeft: index === 0 ? 0 : SEGMENT_GAP_PX,
            backgroundColor: hit === 'bar' ? segment.fill : undefined,
            transformOrigin: 'left'
          },
          onMouseEnter: () => onActivate(segment.key),
          onMouseLeave: onDeactivate,
          onFocus: () => onActivate(segment.key),
          onBlur: onDeactivate,
          initial: animated ? { scaleX: 0 } : false,
          animate: { scaleX: 1 },
          transition: animated
            ? { duration: 0.32, ease: 'easeOut' as const, delay: (segment.order ?? 0) * 0.08 }
            : { duration: 0 }
        }
        const ariaLabel = [segment.card.title, ...segment.card.lines].join(', ')
        const visual =
          hit === 'row' ? (
            <span
              className={cn(
                'block h-2 w-full',
                visualClass,
                index === 0 && 'rounded-l-[1px]',
                index === segments.length - 1 && 'rounded-r-[1px]'
              )}
              style={{ backgroundColor: segment.fill }}
            />
          ) : null
        const onSelect = segment.onSelect

        return (
          <Tooltip key={segment.key}>
            <TooltipTrigger asChild>
              {onSelect !== undefined ? (
                <motion.button
                  type="button"
                  aria-pressed={segment.pressed}
                  aria-label={ariaLabel}
                  onClick={onSelect}
                  {...triggerProps}
                >
                  {visual}
                </motion.button>
              ) : segment.focusable ? (
                <motion.div role="img" tabIndex={0} aria-label={ariaLabel} {...triggerProps}>
                  {visual}
                </motion.div>
              ) : (
                <motion.div aria-hidden {...triggerProps}>
                  {visual}
                </motion.div>
              )}
            </TooltipTrigger>
            <TooltipContent>
              <div className="flex flex-col gap-0.5">
                <span className="font-medium">{segment.card.title}</span>
                {segment.card.subtitle !== undefined && (
                  <span className="text-background/70">{segment.card.subtitle}</span>
                )}
                {segment.card.lines.map((line) => (
                  <span key={line} className="tabular-nums">
                    {line}
                  </span>
                ))}
              </div>
            </TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}
