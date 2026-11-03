import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import type { ProjectLabelResolver } from '@/lib/project-tree'
import type {
  ActivityDay,
  ActivityHour,
  HistoryCoverage,
  TokenCounts
} from '../../../../shared/ipc'
import { TokenReadout } from './TokenReadout'
import { ChartBlock } from './ChartBlock'
import { RankedList } from './RankedList'
import { formatCount } from './chart-utils'

function formatDateLabel(date: Date): string {
  return date.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  })
}

function formatHourBoundary(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short'
  })
}

function formatRangeBoundary(timestamp: string): string {
  return new Date(timestamp).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short'
  })
}

// Hour titles carry start/end times and timezone so a repeated DST hour reads as distinct.
function formatBucketTitle(bucket: ActivityDay | ActivityHour): string {
  if ('date' in bucket) return formatDateLabel(new Date(`${bucket.date}T00:00:00`))
  return `${formatDateLabel(new Date(bucket.startAt))} · ${formatHourBoundary(bucket.startAt)}–${formatHourBoundary(bucket.endAt)}`
}

export function ActivityDetailsDialog({
  bucket,
  open,
  onOpenChange,
  onRestoreFocus,
  resolveProjectLabel,
  tokens,
  coverage,
  pending = false,
  loadError = false,
  onRetry,
  fallbackTitle
}: {
  bucket: ActivityDay | ActivityHour | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onRestoreFocus: () => void
  resolveProjectLabel: ProjectLabelResolver
  tokens?: TokenCounts | null
  coverage?: HistoryCoverage
  pending?: boolean
  loadError?: boolean
  onRetry?: () => void
  fallbackTitle?: string
}): React.JSX.Element | null {
  if (!bucket && !open) return null
  const partial = bucket !== null && 'date' in bucket && bucket.partial
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[85vh] overflow-y-auto sm:max-w-2xl"
        // Radix would focus the first project row, popping its full-path tooltip on open and
        // making the first Escape close the tooltip instead of the dialog.
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          // Radix dispatches this on the content element, typed as a bare Event.
          const content = event.currentTarget as HTMLElement
          content.querySelector<HTMLElement>('[data-slot="dialog-close"]')?.focus()
        }}
        // Opened from a chart column, not a DialogTrigger: Radix would otherwise drop focus on body.
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          onRestoreFocus()
        }}
      >
        <DialogHeader>
          <DialogTitle className="pr-6 text-[16px]">
            {bucket
              ? `${formatBucketTitle(bucket)} · Activity details`
              : (fallbackTitle ?? 'Activity details')}
          </DialogTitle>
          <DialogDescription className="text-[12px]">
            {bucket
              ? `${formatRangeBoundary(bucket.startAt)}–${formatRangeBoundary(bucket.endAt)}`
              : pending
                ? 'Loading day details…'
                : 'Day details are unavailable.'}
            {partial && ' · partial day'}
          </DialogDescription>
        </DialogHeader>
        {loadError && (
          <p role="alert" className="text-[13px] text-muted-foreground">
            Could not load day details.{' '}
            <button type="button" onClick={onRetry} className="underline underline-offset-2">
              Retry
            </button>
          </p>
        )}
        {coverage === 'partial' && (
          <p className="text-[12px] text-muted-foreground">
            Only part of this day’s history is available. The counts reflect recorded activity.
          </p>
        )}
        {coverage === 'unavailable' && (
          <p className="text-[12px] text-muted-foreground">
            Prompt history is unavailable for this day. Any token figures come from separately
            recorded session data.
          </p>
        )}
        {bucket && (
          <>
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-start gap-x-10 gap-y-4">
                <DetailStat label="Sessions" value={bucket.sessions} />
                <span aria-hidden className="mt-1 hidden h-9 w-px bg-border sm:block" />
                <DetailStat label="Prompts" value={bucket.count} />
              </div>
              <p className="text-[13px] text-muted-foreground">
                + {formatCount(bucket.slashCommands)} bare slash-command
                {bucket.slashCommands === 1 ? '' : 's'} (
                <span className="font-mono text-[12px]">/clear</span>,{' '}
                <span className="font-mono text-[12px]">/quit</span>) — not counted as prompts
              </p>
            </div>
            <ChartBlock label="By project">
              <RankedList
                key={bucket.startAt}
                items={bucket.byProject.map((project) => ({
                  label: resolveProjectLabel(project.project),
                  fullLabel: project.project,
                  value: project.count
                }))}
                formatValue={formatCount}
                noun="projects"
              />
            </ChartBlock>
          </>
        )}
        {tokens !== undefined && bucket && (
          <div className="flex flex-col gap-3 border-t border-border pt-4">
            <p className="text-[13px] font-medium">
              {tokens
                ? `${formatCount(tokens.total)} estimated tokens processed`
                : 'Token data unavailable'}
            </p>
            {tokens && <TokenReadout tokens={tokens} />}
            {tokens && (
              <p className="text-[12px] text-muted-foreground">
                Estimated shares of recorded session totals. Thinking is included in output.
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function DetailStat({ label, value }: { label: string; value: number }): React.JSX.Element {
  return (
    <div className="flex min-w-[72px] flex-col gap-1">
      <span className="text-usage-stat text-foreground">{formatCount(value)}</span>
      <span className="text-[11px] font-medium uppercase tracking-[0.04em] text-muted-foreground">
        {label}
      </span>
    </div>
  )
}
