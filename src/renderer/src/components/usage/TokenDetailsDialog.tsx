import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import type { ProjectLabelResolver } from '@/lib/project-tree'
import { seriesColor, type ModelIdentity } from '@/lib/model-identity'
import type { TokenBucket } from '../../../../shared/ipc'
import { formatExactTokenCount, formatTokenCount } from '../../../../shared/token-format'
import { ChartBlock } from './ChartBlock'
import { RankedList } from './RankedList'
import { ProjectRankedList } from './ProjectRankedList'
import { TokenReadout } from './TokenReadout'
import { TokenValue } from './TokenValue'
import { formatModelName } from './chart-utils'

export function TokenDetailsDialog({
  bucket,
  hourly,
  open,
  onOpenChange,
  onRestoreFocus,
  identifyModel,
  resolveProjectLabel
}: {
  bucket: TokenBucket | null
  hourly: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onRestoreFocus: () => void
  identifyModel: (key: string) => ModelIdentity
  resolveProjectLabel: ProjectLabelResolver
}): React.JSX.Element | null {
  if (!bucket || !bucket.tokens) return null
  const start = new Date(bucket.startAt)
  const dateLabel = start.toLocaleDateString(undefined, {
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
  const label = hourly
    ? `${dateLabel} · ${formatHour(bucket.startAt)}–${formatHour(bucket.endAt)}`
    : dateLabel
  const formatBoundary = (timestamp: string): string =>
    new Date(timestamp).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short'
    })
  const formatExactValue = (value: number): string =>
    `${formatExactTokenCount(value)} tokens · estimated`

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-h-[85vh] overflow-y-auto sm:max-w-2xl"
        // Avoid opening a token tooltip on arrival, so the first Escape closes the dialog.
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          const content = event.currentTarget as HTMLElement
          content.querySelector<HTMLElement>('[data-slot="dialog-close"]')?.focus()
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          onRestoreFocus()
        }}
      >
        <DialogHeader>
          <DialogTitle className="pr-6 text-[16px]">{label} · Token details</DialogTitle>
          <DialogDescription className="text-[12px]">
            {formatBoundary(bucket.startAt)}–{formatBoundary(bucket.endAt)}
            {bucket.partial && ' · partial day'}
          </DialogDescription>
        </DialogHeader>
        <div>
          <p className="text-usage-stat text-foreground">
            <TokenValue
              value={bucket.tokens.total}
              hint="Estimated share of recorded session totals"
            />
          </p>
          <p className="mt-1 text-[11px] uppercase tracking-[0.04em] text-muted-foreground">
            Total tokens processed · estimated
          </p>
        </div>
        <TokenReadout tokens={bucket.tokens} />
        <p className="text-[12px] text-muted-foreground">
          Input + output + cache reads + cache writes. Thinking is included in output. These are
          estimated shares of recorded session totals, allocated using response activity. Full
          integer counts describe the allocation, not exact measurements of this interval.
        </p>
        <ChartBlock label="By model" empty={bucket.byModel.length === 0}>
          <RankedList
            items={bucket.byModel.map((row) => ({
              label: formatModelName(row.key),
              fullLabel: row.key,
              value: row.tokens.total,
              swatch: seriesColor(identifyModel(row.key))
            }))}
            totalValue={bucket.tokens.total}
            formatValue={formatTokenCount}
            formatExactValue={formatExactValue}
            noun="models"
          />
        </ChartBlock>
        <ChartBlock label="By project" empty={bucket.byProject.length === 0}>
          <ProjectRankedList
            items={bucket.byProject.map((row) => ({
              label: resolveProjectLabel(row.key),
              fullLabel: row.key,
              value: row.tokens.total
            }))}
            formatValue={formatTokenCount}
            formatExactValue={formatExactValue}
            noun="projects"
          />
        </ChartBlock>
      </DialogContent>
    </Dialog>
  )
}
