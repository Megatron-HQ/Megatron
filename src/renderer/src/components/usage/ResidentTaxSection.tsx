import { useRef, useState } from 'react'
import { queryOptions, useQuery } from '@tanstack/react-query'
import { Layers3, RefreshCw } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { formatRelativeTime } from '@/lib/relative-time'
import type { ContextCategory, ContextUsage } from '../../../../shared/ipc'
import { formatModelName } from './chart-utils'
import { ResidentCompositionBar } from './ResidentCompositionBar'
import { ResidentDrillDialog } from './ResidentDrillDialog'
import { resolveDrillTarget, type DrillTarget } from './resident-drill'

// Measured once per app launch (the CLI run takes seconds and starts MCP servers and hooks),
// then only on Refresh. Kept in memory; never written to the index. `always`: this is local IPC,
// so an offline machine must not park it as a paused network request.
const contextBaselineQuery = queryOptions({
  queryKey: ['context-baseline'],
  queryFn: () => window.api.getContextBaseline(),
  staleTime: Infinity,
  gcTime: Infinity,
  retry: false,
  networkMode: 'always'
})

export function ResidentTaxRefresh(): React.JSX.Element {
  const { isFetching: fetching, refetch } = useQuery(contextBaselineQuery)
  return (
    <button
      type="button"
      disabled={fetching}
      onClick={() => void refetch()}
      className="flex items-center gap-1.5 rounded-md border border-border px-2 py-0.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground disabled:cursor-default disabled:hover:text-muted-foreground"
    >
      <RefreshCw
        aria-hidden
        className={cn('size-3', fetching && 'animate-spin motion-reduce:animate-none')}
      />
      {fetching ? 'Measuring…' : 'Refresh'}
    </button>
  )
}

export function ResidentTaxSection(): React.JSX.Element {
  const { data, isPending, isError, isFetching, refetch } = useQuery(contextBaselineQuery)
  const retry = { retrying: isFetching, onRetry: () => void refetch() }
  if (isPending) return <ResidentTaxSkeleton />
  if (isError) {
    return <ResidentTaxError message="Megatron couldn't run Claude Code's /context." {...retry} />
  }
  if (!data.ok) return <ResidentTaxError message={data.error} raw={data.raw} {...retry} />
  return <ResidentTaxBreakdown usage={data.usage} measuredAt={data.measuredAt} />
}

function ResidentTaxBreakdown({
  usage,
  measuredAt
}: {
  usage: ContextUsage
  measuredAt: string
}): React.JSX.Element {
  const [target, setTarget] = useState<DrillTarget | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const triggerRef = useRef<HTMLElement | null>(null)

  const openDrill = (category: ContextCategory, trigger: HTMLElement): void => {
    triggerRef.current = trigger
    setTarget(resolveDrillTarget(usage, category))
    setDialogOpen(true)
  }

  return (
    <section className="flex flex-col gap-6 py-8">
      <div className="flex flex-col gap-1">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-usage-stat text-foreground">{usage.totalDisplay}</span>
          <span className="font-mono text-[13px] tabular-nums text-muted-foreground">
            / {usage.windowDisplay.toUpperCase()} · {usage.percentDisplay}
          </span>
        </span>
        <span className="text-[11px] font-medium uppercase tracking-[0.04em] text-muted-foreground">
          In context before your first message
        </span>
      </div>

      <ResidentCompositionBar usage={usage} onDrill={openDrill} />

      <div className="flex flex-col gap-1 text-[11px] leading-relaxed text-muted-foreground">
        <p className="max-w-[620px]">
          Claude Code&apos;s own /context breakdown, measured from an empty folder so no
          project&apos;s instructions, skills, or MCP servers are counted. Deferred tools stay out
          of context until Claude searches for them.
        </p>
        <p className="flex flex-wrap gap-x-1.5">
          <span>Global baseline</span>
          <span aria-hidden>·</span>
          <span>{formatModelName(usage.model)}</span>
          <span aria-hidden>·</span>
          <span>measured {formatRelativeTime(measuredAt)}</span>
        </p>
      </div>

      <ResidentDrillDialog
        target={target}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onRestoreFocus={() => triggerRef.current?.focus()}
      />
    </section>
  )
}

function ResidentTaxSkeleton(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-6 py-8" aria-busy="true">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-3 w-48" />
      </div>
      <Skeleton className="h-3 w-full" />
      <div className="flex flex-col gap-2">
        {Array.from({ length: 7 }).map((_, index) => (
          <Skeleton key={index} className="h-8 w-full" />
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">Running /context in Claude Code…</p>
    </div>
  )
}

function ResidentTaxError({
  message,
  raw,
  retrying,
  onRetry
}: {
  message: string
  raw?: string
  retrying: boolean
  onRetry: () => void
}): React.JSX.Element {
  return (
    <div role="alert" className="flex flex-col items-center gap-2 py-24 text-center">
      <Layers3 className="size-8 text-muted-foreground" />
      <p className="text-[13px] font-medium">Couldn&apos;t measure resident context</p>
      <p className="max-w-[430px] text-[13px] text-muted-foreground">{message}</p>
      {raw && (
        <pre className="max-h-64 w-full max-w-[620px] overflow-auto whitespace-pre-wrap break-words rounded-sm bg-muted p-2 text-left font-mono text-[11px] text-foreground">
          {raw}
        </pre>
      )}
      <button
        type="button"
        disabled={retrying}
        className="mt-1 text-[13px] text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:no-underline"
        onClick={onRetry}
      >
        {retrying ? 'Measuring…' : 'Retry'}
      </button>
    </div>
  )
}
