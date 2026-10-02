import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { getFolderBasename } from '@/lib/source-name'
import type { CostDay } from '../../../../shared/ipc'
import { ChartBlock } from './ChartBlock'
import { RankedList } from './RankedList'
import { SpendBar } from './SpendBar'
import { formatUsd } from './chart-utils'

export const COST_ATTRIBUTION_NOTE =
  'Recorded session cost is spread across activity timestamps proportionally. Time and model/project breakdowns are approximate.'

export function CostDayDialog({
  day,
  open,
  onOpenChange,
  onRestoreFocus
}: {
  day: CostDay | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onRestoreFocus: () => void
}): React.JSX.Element | null {
  if (!day) return null
  const [year, month, date] = day.date.split('-').map(Number)
  const label = new Date(year, month - 1, date).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  })
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
            {formatBoundary(day.startAt)}–{formatBoundary(day.endAt)}
            {day.partial && ' · partial day'}
          </DialogDescription>
        </DialogHeader>
        <SpendBar total={day.costUsd} byModel={day.byModel} />
        <p className="text-[11px] text-muted-foreground">
          {day.pricedSessionCount.toLocaleString()} contributing session
          {day.pricedSessionCount === 1 ? '' : 's'}. {COST_ATTRIBUTION_NOTE} API-equivalent
          estimate, not a charge.
        </p>
        {day.hasUnknownModelCost && (
          <p className="text-[11px] text-muted-foreground">
            Some usage ran on a model Claude Code couldn&apos;t price; this is a low estimate.
          </p>
        )}
        <ChartBlock label="By project">
          <RankedList
            key={day.date}
            items={day.byProject.map((project) => ({
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
