import { Layers3 } from 'lucide-react'
import { formatRelativeTime } from '@/lib/relative-time'
import { getFolderBasename } from '@/lib/source-name'
import type { ResidentTaxStats } from '../../../../shared/ipc'
import { formatModelName } from './chart-utils'
import { ResidentCompositionBar } from './ResidentCompositionBar'

export function ResidentTaxSection({
  stats
}: {
  stats: ResidentTaxStats | null
}): React.JSX.Element {
  if (stats === null) return <ResidentTaxEmpty />

  return (
    <section className="flex flex-col gap-6 py-8">
      <div className="flex flex-col gap-1">
        <span className="text-usage-stat text-foreground">
          {stats.measuredTokens.toLocaleString()}
        </span>
        <span className="text-[11px] font-medium uppercase tracking-[0.04em] text-muted-foreground">
          Measured turn-one resident tokens
        </span>
      </div>

      <ResidentCompositionBar total={stats.measuredTokens} categories={stats.categories} />

      <div className="flex flex-col gap-1 text-[11px] leading-relaxed text-muted-foreground">
        <p className="max-w-[620px]">
          The total is Claude Code&apos;s measured first-turn cache write from a recent cold
          session. Itemized rows are estimates from the exact injected text; the remainder has not
          yet been safely itemized.
        </p>
        <p className="flex flex-wrap gap-x-1.5">
          <span title={stats.project}>{getFolderBasename(stats.project)}</span>
          <span aria-hidden>·</span>
          <span>{formatModelName(stats.model)}</span>
          {stats.claudeVersion && (
            <>
              <span aria-hidden>·</span>
              <span>Claude Code {stats.claudeVersion}</span>
            </>
          )}
          <span aria-hidden>·</span>
          <span>sampled {formatRelativeTime(stats.sampledAt)}</span>
        </p>
      </div>
    </section>
  )
}

function ResidentTaxEmpty(): React.JSX.Element {
  return (
    <div className="flex flex-col items-center gap-2 py-24 text-center">
      <Layers3 className="size-8 text-muted-foreground" />
      <p className="text-[13px] font-medium">No cold-session sample yet</p>
      <p className="max-w-[430px] text-[13px] text-muted-foreground">
        Resident tax appears when Megatron finds a recent first turn with a cold cache and complete
        context measurements.
      </p>
    </div>
  )
}
