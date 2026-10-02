import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { getFolderBasename } from '@/lib/source-name'
import type { CostDay, CostHour } from '../../../../shared/ipc'
import { ChartBlock } from './ChartBlock'
import { RankedList } from './RankedList'
import { SpendBar } from './SpendBar'
import { formatUsd } from './chart-utils'

export const COST_ATTRIBUTION_NOTE =
  'Recorded session cost is spread across activity timestamps proportionally. Time and model/project breakdowns are approximate.'

export function CostDetailsDialog({
  bucket,
  open,
  onOpenChange,
  onRestoreFocus
}: {
  bucket: CostDay | CostHour | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onRestoreFocus: () => void
}): React.JSX.Element | null {
  if (!bucket) return null
  const isDay = 'date' in bucket
  const start = new Date(bucket.startAt)
  const date = isDay ? new Date(`${bucket.date}T00:00:00`) : start
  const dateLabel = date.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  })
  const formatHour = (timestamp: string): string =>
    new Date(timestamp).toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short'
    })
  const label = isDay
    ? dateLabel
    : `${dateLabel} · ${formatHour(bucket.startAt)}–${formatHour(bucket.endAt)}`
  const formatBoundary = (timestamp: string): string =>
    new Date(timestamp).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short'
    })
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[85vh] overflow-y-auto sm:max-w-2xl"
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          onRestoreFocus()
        }}
      >
        <DialogHeader>
          <DialogTitle className="pr-6 text-[16px]">{label} · Cost details</DialogTitle>
          <DialogDescription className="text-[12px]">
            {formatBoundary(bucket.startAt)}–{formatBoundary(bucket.endAt)}
            {isDay && bucket.partial && ' · partial day'}
          </DialogDescription>
        </DialogHeader>
        <SpendBar total={bucket.costUsd} byModel={bucket.byModel} />
        <p className="text-[11px] text-muted-foreground">
          {bucket.pricedSessionCount.toLocaleString()} contributing session
          {bucket.pricedSessionCount === 1 ? '' : 's'}. {COST_ATTRIBUTION_NOTE} API-equivalent
          estimate, not a charge.
        </p>
        {bucket.hasUnknownModelCost && (
          <p className="text-[11px] text-muted-foreground">
            Some usage ran on a model Claude Code couldn&apos;t price; this is a low estimate.
          </p>
        )}
        <ChartBlock label="By project">
          <RankedList
            key={bucket.startAt}
            items={bucket.byProject.map((project) => ({
              label: getFolderBasename(project.project),
              fullLabel: project.project,
              value: project.costUsd
            }))}
            formatValue={(value) => formatUsd(value, { cents: true })}
            noun="projects"
          />
        </ChartBlock>
      </DialogContent>
    </Dialog>
  )
}
