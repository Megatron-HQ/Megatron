import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BarChart3 } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { formatRelativeTime } from '@/lib/relative-time'
import { ChartBlock } from '@/components/usage/ChartBlock'
import { StatCells } from '@/components/usage/StatCells'
import { DayStrip } from '@/components/usage/DayStrip'
import { Punchcard } from '@/components/usage/Punchcard'
import { ProjectBars } from '@/components/usage/ProjectBars'
import type { ActivityWindow } from '../../../shared/ipc'

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
            win && <ActivitySection win={win} />
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
        <DayStrip byDay={win.byDay} days={win.days} />
      </ChartBlock>

      <ChartBlock label="By time of day" empty={windowEmpty} emptyMessage={emptyMessage}>
        <Punchcard
          byHourWeekday={win.byHourWeekday}
          byHour={win.byHour}
          byWeekday={win.byWeekday}
        />
      </ChartBlock>

      <ChartBlock label="By project" empty={win.byProject.length === 0} emptyMessage={emptyMessage}>
        <ProjectBars byProject={win.byProject} />
      </ChartBlock>
    </section>
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
  )
}
