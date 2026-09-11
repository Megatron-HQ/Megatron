import { useEffect, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Activity, BrainCircuit, CircleDollarSign, Cpu, TriangleAlert } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { formatRelativeTime } from '@/lib/relative-time'
import { getFolderBasename } from '@/lib/source-name'
import { ChartBlock } from '@/components/usage/ChartBlock'
import { StatCells } from '@/components/usage/StatCells'
import { DayStrip } from '@/components/usage/DayStrip'
import { InvocationTrend } from '@/components/usage/InvocationTrend'
import { Punchcard } from '@/components/usage/Punchcard'
import { RankedList } from '@/components/usage/RankedList'
import { SpendBar } from '@/components/usage/SpendBar'
import { SkillsSection, SkillWindowToggle } from '@/components/usage/SkillsSection'
import { ModelsSection } from '@/components/usage/ModelsSection'
import { formatCount, formatUsd } from '@/components/usage/chart-utils'
import type { UsagePanel } from '@/components/UsageSidebar'
import type {
  ActivityStats,
  ActivityWindow,
  CostStats,
  SkillStatsWindowKey
} from '../../../shared/ipc'

export type ActivityWindowKey = '24h' | '7d' | '30d'

const PANEL_META = {
  activity: { label: 'Activity', Icon: Activity },
  cost: { label: 'Cost', Icon: CircleDollarSign },
  models: { label: 'Models', Icon: Cpu },
  skills: { label: 'Skills', Icon: BrainCircuit }
} as const

export function UsageView({
  panel,
  activityWindow,
  onActivityWindowChange,
  modelWindow,
  onModelWindowChange,
  skillWindow,
  onSkillWindowChange,
  onSelectSkill
}: {
  panel: UsagePanel
  activityWindow: ActivityWindowKey
  onActivityWindowChange: (window: ActivityWindowKey) => void
  modelWindow: SkillStatsWindowKey
  onModelWindowChange: (window: SkillStatsWindowKey) => void
  skillWindow: SkillStatsWindowKey
  onSkillWindowChange: (window: SkillStatsWindowKey) => void
  onSelectSkill?: (skillId: number) => void
}): React.JSX.Element {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const reduceMotion = useReducedMotion() === true

  const { data, isPending, isFetching } = useQuery({
    queryKey: ['usage'],
    queryFn: () => window.api.getUsageOverview(),
    refetchInterval: (query) => (query.state.data?.scanComplete ? false : 750)
  })

  useEffect(() => {
    scrollContainerRef.current?.scrollTo({ top: 0 })
  }, [panel])

  const loading = isPending || !data?.scanComplete
  const { label, Icon } = PANEL_META[panel]

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="flex h-10 shrink-0 items-center justify-between border-b border-border px-4">
        <span className="flex items-center gap-1.5 text-[13px] font-semibold">
          <Icon className="size-3.5" />
          {label}
        </span>
        {!loading && (
          <div className="flex items-center gap-3">
            {panel === 'activity' && (
              <ActivityWindowToggle value={activityWindow} onChange={onActivityWindowChange} />
            )}
            {panel === 'skills' && (
              <SkillWindowToggle value={skillWindow} onChange={onSkillWindowChange} />
            )}
            {panel === 'models' && (
              <SkillWindowToggle
                value={modelWindow}
                onChange={onModelWindowChange}
                ariaLabel="Model activity window"
              />
            )}
            {data?.activity && (
              <span
                className={cn('text-[11px] text-muted-foreground', isFetching && 'animate-pulse')}
              >
                Updated {formatRelativeTime(data.activity.generatedAt)}
              </span>
            )}
          </div>
        )}
      </header>

      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
        <div className="w-full px-6">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={panel}
              initial={reduceMotion ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduceMotion ? 0 : 0.15, ease: 'easeOut' }}
            >
              {loading ? (
                <UsageSkeleton panel={panel} />
              ) : panel === 'activity' ? (
                <ActivityPanel activity={data?.activity ?? null} windowKey={activityWindow} />
              ) : panel === 'cost' ? (
                <CostSection cost={data?.cost ?? null} />
              ) : panel === 'models' ? (
                data?.models && data.models.last30d.turnCount > 0 ? (
                  <ModelsSection stats={data.models} windowKey={modelWindow} />
                ) : (
                  <ModelsEmpty />
                )
              ) : data?.skills ? (
                <SkillsSection
                  stats={data.skills}
                  windowKey={skillWindow}
                  onSelectSkill={onSelectSkill}
                />
              ) : (
                <SkillsEmpty />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}

function ActivityWindowToggle({
  value,
  onChange
}: {
  value: ActivityWindowKey
  onChange: (value: ActivityWindowKey) => void
}): React.JSX.Element {
  const windows: { key: ActivityWindowKey; label: string }[] = [
    { key: '24h', label: '24 hours' },
    { key: '7d', label: '7 days' },
    { key: '30d', label: '30 days' }
  ]

  return (
    <div
      role="radiogroup"
      aria-label="Activity window"
      className="flex gap-1 rounded-md border border-border p-0.5"
    >
      {windows.map(({ key, label }) => (
        <button
          key={key}
          type="button"
          role="radio"
          aria-checked={key === value}
          onClick={() => onChange(key)}
          className={cn(
            'rounded-sm px-2 py-0.5 text-[12px] transition-colors',
            key === value
              ? 'bg-muted text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

function selectActivityWindow(activity: ActivityStats, key: ActivityWindowKey): ActivityWindow {
  if (key === '24h') return activity.last24h
  if (key === '7d') return activity.last7d
  return activity.last30d
}

function ActivityPanel({
  activity,
  windowKey
}: {
  activity: ActivityStats | null
  windowKey: ActivityWindowKey
}): React.JSX.Element {
  if (
    activity === null ||
    (activity.last30d.prompts === 0 && activity.last30d.slashCommands === 0)
  ) {
    return <NoHistory />
  }

  const window = selectActivityWindow(activity, windowKey)
  return (
    <ActivitySection
      win={window}
      windowKey={windowKey}
      hourlyTrend={activity.last24h.hourlyTrend}
    />
  )
}

function ActivitySection({
  win,
  windowKey,
  hourlyTrend
}: {
  win: ActivityWindow
  windowKey: ActivityWindowKey
  hourlyTrend: { key: string; count: number }[]
}): React.JSX.Element {
  const windowEmpty = win.prompts === 0 && win.slashCommands === 0
  const windowLabel = windowKey === '24h' ? '24 hours' : `${win.days} days`
  const emptyMessage = `No prompts in the last ${windowLabel}`

  return (
    <section className="flex flex-col gap-6 py-8">
      <StatCells
        activeDays={win.activeDays}
        sessions={win.sessions}
        prompts={win.prompts}
        slashCommands={win.slashCommands}
        days={win.days}
      />

      {windowKey === '24h' ? (
        <ChartBlock label="By hour" empty={windowEmpty} emptyMessage={emptyMessage}>
          <InvocationTrend data={hourlyTrend} window="24h" nounSingular="prompt" />
        </ChartBlock>
      ) : (
        <>
          <ChartBlock label="By day" empty={windowEmpty} emptyMessage={emptyMessage}>
            <DayStrip
              data={win.byDay.map((day) => ({
                date: day.date,
                value: day.count,
                weekday: day.weekday
              }))}
              days={win.days}
              formatValue={(value) => `${formatCount(value)} prompts`}
            />
          </ChartBlock>

          <ChartBlock label="By time of day" empty={windowEmpty} emptyMessage={emptyMessage}>
            <Punchcard
              byHourWeekday={win.byHourWeekday}
              byHour={win.byHour}
              byWeekday={win.byWeekday}
            />
          </ChartBlock>
        </>
      )}

      <ChartBlock label="By project" empty={win.byProject.length === 0} emptyMessage={emptyMessage}>
        <RankedList
          items={win.byProject.map((project) => ({
            label: getFolderBasename(project.project),
            value: project.count,
            fullLabel: project.project
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
    const count = cost.preTrackingSessionCount
    text += ` ${count.toLocaleString()} earlier session${count === 1 ? '' : 's'} predate cost tracking`
    if (epochBound) text += ' (added August 2026)'
  }
  if (clause3) {
    const count = cost.unusableSessionCount
    text += clause2 ? ', and ' : ' '
    text += `${count.toLocaleString()}${clause2 ? ' more' : ''} ${count === 1 ? 'has' : 'have'} no usable cost data`
  }
  if (clause2 || clause3) text += ' — not included above.'
  return text
}

function CostSection({ cost }: { cost: CostStats | null }): React.JSX.Element {
  return (
    <section className="flex flex-col gap-6 py-8">
      {cost === null ? <CostEmpty /> : <CostBody cost={cost} />}
    </section>
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
  const projectItems = cost.byProject.map((project) => ({
    label: getFolderBasename(project.project),
    value: project.costUsd,
    fullLabel: project.project
  }))
  const dayData = cost.byDay.map((day) => ({
    date: day.date,
    value: day.costUsd,
    weekday: day.weekday
  }))
  const formatDollars = (value: number): string => formatUsd(value, { cents: true })

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
      <Activity className="size-8 text-muted-foreground" />
      <p className="text-[13px] font-medium">No activity yet</p>
      <p className="max-w-[380px] text-[13px] text-muted-foreground">
        Megatron reads your prompt history from{' '}
        <span className="font-mono text-[12px]">~/.claude/history.jsonl</span>. It&apos;ll show up
        here after your next Claude Code session and a rescan.
      </p>
    </div>
  )
}

function SkillsEmpty(): React.JSX.Element {
  return (
    <div className="flex flex-col items-center gap-2 py-24 text-center">
      <BrainCircuit className="size-8 text-muted-foreground" />
      <p className="text-[13px] font-medium">No skill usage yet</p>
      <p className="max-w-[380px] text-[13px] text-muted-foreground">
        Skill invocations will appear here after they are recorded and Megatron rescans your
        sessions.
      </p>
    </div>
  )
}

function ModelsEmpty(): React.JSX.Element {
  return (
    <div className="flex flex-col items-center gap-2 py-24 text-center">
      <Cpu className="size-8 text-muted-foreground" />
      <p className="text-[13px] font-medium">No model activity yet</p>
      <p className="max-w-[380px] text-[13px] text-muted-foreground">
        Model and effort usage will appear after Megatron rescans a Claude Code session containing
        assistant turns.
      </p>
    </div>
  )
}

function UsageSkeleton({ panel }: { panel: UsagePanel }): React.JSX.Element {
  if (panel === 'cost') {
    return (
      <div className="flex flex-col gap-6 py-8">
        <Skeleton className="h-8 w-28" />
        <Skeleton className="h-2 w-full" />
        <Skeleton className="h-3 w-64" />
        <SkeletonRows count={5} />
        <Skeleton className="h-[72px] w-full" />
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 py-8">
      <div className="flex gap-10">
        {[0, 1, 2].map((index) => (
          <div key={index} className="flex flex-col gap-2">
            <Skeleton className="h-7 w-16" />
            <Skeleton className="h-3 w-20" />
          </div>
        ))}
      </div>
      <Skeleton className="h-[72px] w-full" />
      <Skeleton className="h-40 w-full" />
      <SkeletonRows count={6} />
    </div>
  )
}

function SkeletonRows({ count }: { count: number }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: count }).map((_, index) => (
        <Skeleton key={index} className="h-5 w-full" />
      ))}
    </div>
  )
}
