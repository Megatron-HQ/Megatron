import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion, useReducedMotion } from 'motion/react'
import { BarChart3, CircleDollarSign, TriangleAlert } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { formatRelativeTime } from '@/lib/relative-time'
import { getFolderBasename } from '@/lib/source-name'
import { ChartBlock } from '@/components/usage/ChartBlock'
import { StatCells } from '@/components/usage/StatCells'
import { DayStrip } from '@/components/usage/DayStrip'
import { Punchcard } from '@/components/usage/Punchcard'
import { RankedList } from '@/components/usage/RankedList'
import { SpendBar } from '@/components/usage/SpendBar'
import { SkillsSection } from '@/components/usage/SkillsSection'
import { formatCount, formatUsd } from '@/components/usage/chart-utils'
import type { ActivityWindow, CostStats } from '../../../shared/ipc'

type WindowDays = 7 | 30

export function UsageView(): React.JSX.Element {
  const [windowDays, setWindowDays] = useState<WindowDays>(30)

  const { data, isPending, isFetching } = useQuery({
    queryKey: ['usage'],
    queryFn: () => window.api.getUsageOverview(),
    refetchInterval: (query) => (query.state.data?.scanComplete ? false : 750)
  })

  const loading = isPending || !data?.scanComplete
  const activity = data?.activity
  const win = activity ? (windowDays === 7 ? activity.last7d : activity.last30d) : null
  // No history.jsonl at all vs. a quiet window: a fully empty 30-day window is the former.
  const noHistory =
    activity !== undefined && activity.last30d.prompts === 0 && activity.last30d.slashCommands === 0

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="flex h-10 shrink-0 items-center justify-between border-b border-border px-4">
        <span className="flex items-center gap-1.5 text-[13px] font-semibold">
          <BarChart3 className="size-3.5" />
          Usage
        </span>
        {!loading && (
          <div className="flex items-center gap-3">
            <WindowToggle value={windowDays} onChange={setWindowDays} />
            {activity && (
              <span
                className={cn('text-[11px] text-muted-foreground', isFetching && 'animate-pulse')}
              >
                Updated {formatRelativeTime(activity.generatedAt)}
              </span>
            )}
          </div>
        )}
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="w-full max-w-[960px] px-6">
          {loading ? (
            <UsageSkeleton />
          ) : noHistory ? (
            <NoHistory />
          ) : (
            <>
              {win && <ActivitySection win={win} />}
              <CostSection cost={data?.cost ?? null} />
              {data?.skills && <SkillsSection stats={data.skills} />}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function WindowToggle({
  value,
  onChange
}: {
  value: WindowDays
  onChange: (value: WindowDays) => void
}): React.JSX.Element {
  return (
    <div
      role="radiogroup"
      aria-label="Time window"
      className="flex gap-1 rounded-md border border-border p-0.5"
    >
      {([7, 30] as const).map((days) => {
        const active = days === value
        return (
          <button
            key={days}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(days)}
            className={cn(
              'rounded-sm px-2 py-0.5 text-[12px] transition-colors',
              active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {days} days
          </button>
        )
      })}
    </div>
  )
}

function ActivitySection({ win }: { win: ActivityWindow }): React.JSX.Element {
  const windowEmpty = win.prompts === 0 && win.slashCommands === 0
  const emptyMessage = `No prompts in the last ${win.days} days`

  return (
    <section className="flex flex-col gap-6 py-8">
      <div className="flex flex-col gap-1">
        <h2 className="text-[13px] font-semibold">Activity</h2>
      </div>

      <StatCells
        activeDays={win.activeDays}
        sessions={win.sessions}
        prompts={win.prompts}
        slashCommands={win.slashCommands}
        days={win.days}
      />

      <ChartBlock label="By day" empty={windowEmpty} emptyMessage={emptyMessage}>
        <DayStrip
          data={win.byDay.map((d) => ({ date: d.date, value: d.count, weekday: d.weekday }))}
          days={win.days}
          formatValue={(v) => `${formatCount(v)} prompts`}
        />
      </ChartBlock>

      <ChartBlock label="By time of day" empty={windowEmpty} emptyMessage={emptyMessage}>
        <Punchcard
          byHourWeekday={win.byHourWeekday}
          byHour={win.byHour}
          byWeekday={win.byWeekday}
        />
      </ChartBlock>

      <ChartBlock label="By project" empty={win.byProject.length === 0} emptyMessage={emptyMessage}>
        <RankedList
          items={win.byProject.map((p) => ({
            label: getFolderBasename(p.project),
            value: p.count,
            fullLabel: p.project
          }))}
          formatValue={formatCount}
          noun="projects"
        />
      </ChartBlock>
    </section>
  )
}

// Feature epoch — cost-state first shipped ~2026-08-21. The "(added August 2026)" clause only
// makes sense while trackedSince still sits near it; once retention has pruned the old
// transcripts, preTrackingSessionCount is normally 0 and the whole clause drops itself.
const FEATURE_EPOCH_MS = new Date('2026-08-21T00:00:00.000Z').getTime()
const EPOCH_WINDOW_MS = 10 * 86_400_000

function costFootnote(cost: CostStats): string {
  const since = new Date(cost.trackedSince).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  })
  const priced = cost.pricedSessionCount
  let text = `Covers ${priced.toLocaleString()} session${priced === 1 ? '' : 's'} since ${since}.`

  const clause2 = cost.preTrackingSessionCount > 0
  const clause3 = cost.unusableSessionCount > 0
  const epochBound =
    Math.abs(new Date(cost.trackedSince).getTime() - FEATURE_EPOCH_MS) <= EPOCH_WINDOW_MS

  if (clause2) {
    const n = cost.preTrackingSessionCount
    text += ` ${n.toLocaleString()} earlier session${n === 1 ? '' : 's'} predate cost tracking`
    if (epochBound) text += ' (added August 2026)'
  }
  if (clause3) {
    const n = cost.unusableSessionCount
    text += clause2 ? ', and ' : ' '
    text += `${n.toLocaleString()}${clause2 ? ' more' : ''} ${n === 1 ? 'has' : 'have'} no usable cost data`
  }
  if (clause2 || clause3) text += ' — not included above.'
  return text
}

function CostSection({ cost }: { cost: CostStats | null }): React.JSX.Element {
  const reduceMotion = useReducedMotion() === true

  return (
    <motion.section
      className="flex flex-col gap-6 border-t border-border py-8"
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={reduceMotion ? { duration: 0 } : { duration: 0.32, ease: 'easeOut' }}
    >
      <h2 className="text-[13px] font-semibold">Cost</h2>
      {cost === null ? <CostEmpty /> : <CostBody cost={cost} />}
    </motion.section>
  )
}

function CostEmpty(): React.JSX.Element {
  return (
    <div className="flex items-start gap-2 py-4 text-[13px] text-muted-foreground">
      <CircleDollarSign className="mt-0.5 size-4 shrink-0" />
      <p className="max-w-[520px]">
        No cost data yet. Claude Code started recording per-session cost in August 2026 — it&apos;ll
        show here after your next session and a rescan.
      </p>
    </div>
  )
}

function CostBody({ cost }: { cost: CostStats }): React.JSX.Element {
  const projectItems = cost.byProject.map((p) => ({
    label: getFolderBasename(p.project),
    value: p.costUsd,
    fullLabel: p.project
  }))
  const dayData = cost.byDay.map((d) => ({ date: d.date, value: d.costUsd, weekday: d.weekday }))
  const formatDollars = (v: number): string => formatUsd(v, { cents: true })

  return (
    <>
      <div className="flex flex-col gap-2">
        <SpendBar total={cost.totalCostUsd} byModel={cost.byModel} />

        {cost.hasUnknownModelCost && (
          <p className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
            <TriangleAlert className="mt-px size-3 shrink-0 text-warning" />
            Some usage ran on a model Claude Code couldn&apos;t price — the total above is a low
            estimate.
          </p>
        )}

        <p className="max-w-[520px] text-[11px] text-muted-foreground">
          What this would cost at pay-as-you-go API rates — not a charge. Most Claude Code usage
          runs on a subscription billed separately, and these estimates may not match your actual
          bill.
        </p>
        <p className="max-w-[520px] text-[11px] text-muted-foreground">{costFootnote(cost)}</p>
      </div>

      <ChartBlock
        label="By project"
        empty={projectItems.length === 0}
        emptyMessage="No project costs yet"
      >
        <RankedList items={projectItems} formatValue={formatDollars} noun="projects" />
      </ChartBlock>

      <ChartBlock label="By day">
        <DayStrip data={dayData} days={cost.byDay.length} formatValue={formatDollars} />
      </ChartBlock>
    </>
  )
}

function NoHistory(): React.JSX.Element {
  return (
    <div className="flex flex-col items-center gap-2 py-24 text-center">
      <BarChart3 className="size-8 text-muted-foreground" />
      <p className="text-[13px] font-medium">No activity yet</p>
      <p className="max-w-[380px] text-[13px] text-muted-foreground">
        Megatron reads your prompt history from{' '}
        <span className="font-mono text-[12px]">~/.claude/history.jsonl</span>. It&apos;ll show up
        here after your next Claude Code session and a rescan.
      </p>
    </div>
  )
}

function UsageSkeleton(): React.JSX.Element {
  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-6 py-8">
        <Skeleton className="h-4 w-16" />
        <div className="flex gap-10">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex flex-col gap-2">
              <Skeleton className="h-7 w-16" />
              <Skeleton className="h-3 w-20" />
            </div>
          ))}
        </div>
        <Skeleton className="h-[72px] w-full" />
        <Skeleton className="h-40 w-full" />
        <div className="flex flex-col gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-5 w-full" />
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-6 border-t border-border py-8">
        <Skeleton className="h-4 w-12" />
        <div className="flex flex-col gap-3">
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-2 w-full" />
          <Skeleton className="h-3 w-64" />
        </div>
        <div className="flex flex-col gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-5 w-full" />
          ))}
        </div>
        <Skeleton className="h-[72px] w-full" />
      </div>

      <div className="flex flex-col gap-6 border-t border-border py-8">
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-12" />
          <Skeleton className="h-7 w-48" />
        </div>
        <div className="flex gap-10">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex flex-col gap-2">
              <Skeleton className="h-7 w-16" />
              <Skeleton className="h-3 w-20" />
            </div>
          ))}
        </div>
        <Skeleton className="h-[72px] w-full" />
        <div className="flex flex-col gap-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-5 w-full" />
          ))}
        </div>
      </div>
    </div>
  )
}
