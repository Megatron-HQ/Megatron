import { forwardRef, useState } from 'react'
import { ArrowRight, X } from 'lucide-react'
import type {
  WhatsNewAction,
  WhatsNewHighlight,
  WhatsNewRelease
} from '../../../../shared/whats-new'
import { Button } from '@/components/ui/button'
import { LIME_BUTTON } from '@/lib/lime-button'
import { cn } from '@/lib/utils'
import { WHATS_NEW_PREVIEWS } from './previews'

interface Step {
  version: string
  highlight: WhatsNewHighlight
}

function stepsOf(releases: WhatsNewRelease[]): Step[] {
  return releases.flatMap((release) =>
    release.highlights.map((highlight) => ({ version: release.version, highlight }))
  )
}

interface WhatsNewCardProps {
  releases: WhatsNewRelease[]
  onShowMe: (action: WhatsNewAction) => void
  onDismiss: () => void
}

// A corner card, not a dialog: it never blocks the app, takes focus only when asked (F6), and
// steps through every unseen highlight, newest release first.
export const WhatsNewCard = forwardRef<HTMLElement, WhatsNewCardProps>(function WhatsNewCard(
  { releases, onShowMe, onDismiss },
  ref
) {
  const steps = stepsOf(releases)
  const [index, setIndex] = useState(0)
  const step = steps[Math.min(index, steps.length - 1)]
  if (!step) return null
  const isLast = index >= steps.length - 1
  const Preview = step.highlight.preview ? WHATS_NEW_PREVIEWS[step.highlight.preview] : null
  const action = step.highlight.action

  return (
    <section
      ref={ref}
      tabIndex={-1}
      aria-label="What's new in Megatron"
      className="fixed right-4 bottom-4 z-40 flex w-[min(22rem,calc(100vw-2rem))] flex-col gap-3 rounded-lg border border-border bg-card p-4 text-card-foreground shadow-lg outline-none animate-in fade-in-0 duration-150 motion-safe:zoom-in-[0.98]"
    >
      <header className="flex items-center justify-between gap-2">
        <span className="rounded-full border border-border px-2 font-mono text-[11px] leading-5 font-medium text-muted-foreground">
          New in v{step.version}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Dismiss what's new"
          className="text-muted-foreground"
          onClick={onDismiss}
        >
          <X className="size-3.5" />
        </Button>
      </header>

      <div key={index} className="flex flex-col gap-3 animate-in fade-in-0 duration-150">
        {Preview && (
          <div
            inert
            aria-hidden
            className="h-[132px] overflow-hidden rounded-md border border-border bg-background p-2.5"
          >
            <Preview />
          </div>
        )}
        <div aria-live="polite" className="flex flex-col gap-1">
          <h2 className="text-sm leading-5 font-semibold">{step.highlight.title}</h2>
          <p className="text-[13px] leading-5 text-muted-foreground">{step.highlight.body}</p>
        </div>
      </div>

      <footer className="flex items-center justify-between gap-2">
        {steps.length > 1 ? (
          <div className="flex items-center gap-1" role="group" aria-label="Highlights">
            {steps.map((_, dot) => (
              <button
                key={dot}
                type="button"
                aria-label={`Highlight ${dot + 1} of ${steps.length}`}
                aria-current={dot === index ? 'step' : undefined}
                onClick={() => setIndex(dot)}
                className={cn(
                  'h-1.5 rounded-full transition-[width,background-color] duration-150',
                  dot === index
                    ? 'w-4 bg-foreground'
                    : 'w-1.5 bg-muted-foreground/40 hover:bg-muted-foreground'
                )}
              />
            ))}
          </div>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-1.5">
          {action && (
            <Button type="button" variant="ghost" size="sm" onClick={() => onShowMe(action)}>
              Show me
              <ArrowRight className="size-3.5" />
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            className={LIME_BUTTON}
            onClick={isLast ? onDismiss : () => setIndex(index + 1)}
          >
            {isLast ? 'Got it' : 'Next'}
          </Button>
        </div>
      </footer>
    </section>
  )
})
