import { useEffect, useMemo, useRef, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import {
  Activity,
  BrainCircuit,
  CircleDollarSign,
  Cpu,
  Layers3,
  Binary,
  CalendarDays
} from 'lucide-react'
import { TokensSection } from '@/components/usage/TokensSection'
import {
  HistorySection,
  HistorySkeleton,
  HistoryYearToggle
} from '@/components/usage/HistorySection'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { formatRelativeTime } from '@/lib/relative-time'
import { buildModelIdentity } from '@/lib/model-identity'
import { useUsageProjects } from '@/lib/use-usage-projects'
import type { ProjectLabelResolver } from '@/lib/project-tree'
import { ActivityDetailsDialog } from '@/components/usage/ActivityDetailsDialog'
import { ChartBlock } from '@/components/usage/ChartBlock'
import { StatCells } from '@/components/usage/StatCells'
import { DayStrip } from '@/components/usage/DayStrip'
import { InvocationTrend } from '@/components/usage/InvocationTrend'
import { Punchcard } from '@/components/usage/Punchcard'
import { ProjectRankedList } from '@/components/usage/ProjectRankedList'
import { CostSection } from '@/components/usage/CostSection'
import { SkillsSection, SkillWindowToggle } from '@/components/usage/SkillsSection'
import type { SkillInvocationSelection } from '@/components/usage/SkillInvocationDialog'
import { ModelsSection } from '@/components/usage/ModelsSection'
import { ResidentTaxRefresh, ResidentTaxSection } from '@/components/usage/ResidentTaxSection'
import { formatCount } from '@/components/usage/chart-utils'
import type { UsagePanel } from '@/components/UsageSidebar'
import type {
  ActivityHour,
  ActivityStats,
  ActivityWindow,
  CostWindowKey,
  SkillStatsWindowKey
} from '../../../shared/ipc'

export type ActivityWindowKey = '24h' | '7d' | '30d'

const PANEL_META = {
  activity: { label: 'Activity', Icon: Activity },
  history: { label: 'History', Icon: CalendarDays },
  tokens: { label: 'Tokens', Icon: Binary },
  cost: { label: 'Cost', Icon: CircleDollarSign },
  models: { label: 'Models', Icon: Cpu },
  skills: { label: 'Skills', Icon: BrainCircuit },
  'resident-tax': { label: 'Resident tax', Icon: Layers3 }
} as const

export function UsageView({
  panel,
  activityWindow,
  onActivityWindowChange,
  tokenWindow,
  onTokenWindowChange,
  calendarYear,
  onCalendarYearChange,
  costWindow,
  onCostWindowChange,
  modelWindow,
  onModelWindowChange,
  skillWindow,
  onSkillWindowChange,
  onSelectSkill,
  onShowInvocations
}: {
  panel: UsagePanel
  activityWindow: ActivityWindowKey
  onActivityWindowChange: (window: ActivityWindowKey) => void
  tokenWindow: SkillStatsWindowKey
  onTokenWindowChange: (window: SkillStatsWindowKey) => void
  calendarYear: number
  onCalendarYearChange: (year: number) => void
  costWindow: CostWindowKey
  onCostWindowChange: (window: CostWindowKey) => void
  modelWindow: SkillStatsWindowKey
  onModelWindowChange: (window: SkillStatsWindowKey) => void
  skillWindow: SkillStatsWindowKey
  onSkillWindowChange: (window: SkillStatsWindowKey) => void
  onSelectSkill?: (skillId: number) => void
  onShowInvocations: (selection: SkillInvocationSelection) => void
}): React.JSX.Element {
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const reduceMotion = useReducedMotion() === true
  const projects = useUsageProjects()

  const { data, isPending, isFetching, isError, refetch } = useQuery({
    queryKey: ['usage'],
    queryFn: () => window.api.getUsageOverview(),
    refetchInterval: (query) => (query.state.data?.scanComplete ? false : 750)
  })
  const calendar = useQuery({
    queryKey: ['usage', 'calendar', calendarYear],
    queryFn: () => window.api.getUsageCalendar(calendarYear),
    enabled: panel === 'history' && data?.scanComplete === true,
    placeholderData: keepPreviousData
  })

  useEffect(() => {
    scrollContainerRef.current?.scrollTo({ top: 0 })
  }, [panel])

  // One identity for both panels, so a model's tint never differs between Cost and Models.
  const identifyModel = useMemo(
    () =>
      buildModelIdentity([
        ...(data?.cost?.last30d.byModel ?? []).map((entry) => entry.model),
        ...(data?.models?.last30d.byModel ?? []).map((row) => row.model),
        ...(data?.tokens?.last30d.byModel ?? []).map((row) => row.key)
      ]),
    [data?.cost, data?.models, data?.tokens]
  )

  const { resolveProjectLabel } = projects

  const loading = isPending || !data?.scanComplete || projects.isPending
  const { label, Icon } = PANEL_META[panel]

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="flex h-10 shrink-0 items-center justify-between border-b border-border px-4">
        <span className="flex items-center gap-1.5 text-[13px] font-semibold">
          <Icon className="size-3.5" />
          {label}
        </span>
        <div className="flex min-w-0 items-center gap-3">
          {/* Resident tax reads Claude Code's /context, not the index, so it never waits on a scan
            and its freshness is its own measurement, not the overview's. */}
          {panel === 'resident-tax' ? (
            <ResidentTaxRefresh />
          ) : (
            !loading && (
              <div className="flex min-w-0 items-center gap-3">
                {panel === 'history' && (
                  <HistoryYearToggle
                    year={calendarYear}
                    years={calendar.data?.years ?? [calendarYear]}
                    onChange={onCalendarYearChange}
                  />
                )}
                {panel === 'activity' && (
                  <ActivityWindowToggle value={activityWindow} onChange={onActivityWindowChange} />
                )}
                {panel === 'tokens' && (
                  <SkillWindowToggle
                    value={tokenWindow}
                    onChange={onTokenWindowChange}
                    ariaLabel="Token usage window"
                  />
                )}
                {panel === 'cost' && (
                  <ActivityWindowToggle
                    value={costWindow}
                    onChange={onCostWindowChange}
                    ariaLabel="Cost window"
                  />
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
                    className={cn(
                      'shrink-0 text-[11px] text-muted-foreground',
                      isFetching && 'animate-pulse'
                    )}
                  >
                    Updated {formatRelativeTime(data.activity.generatedAt)}
                  </span>
                )}
              </div>
            )
          )}
        </div>
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
              {panel === 'resident-tax' ? (
                <ResidentTaxSection />
              ) : isError || projects.isError ? (
                <div role="alert" className="py-6 text-sm text-muted-foreground">
                  <p>Could not load usage data.</p>
                  <button
                    type="button"
                    className="mt-2 underline underline-offset-2 hover:text-foreground"
                    onClick={() => {
                      void refetch()
                      void projects.refetch()
                    }}
                  >
                    Retry
                  </button>
                </div>
              ) : loading ? (
                <UsageSkeleton panel={panel} />
              ) : panel === 'activity' ? (
                <ActivityPanel
                  activity={data?.activity ?? null}
                  windowKey={activityWindow}
                  resolveProjectLabel={resolveProjectLabel}
                />
              ) : panel === 'history' ? (
                <HistorySection
                  key={calendarYear}
                  data={calendar.data}
                  pending={calendar.isPending || calendar.isPlaceholderData}
                  loadError={calendar.isError}
                  onRetry={() => void calendar.refetch()}
                />
              ) : panel === 'tokens' ? (
                <TokensSection
                  stats={data.tokens}
                  windowKey={tokenWindow}
                  identifyModel={identifyModel}
                  resolveProjectLabel={resolveProjectLabel}
                />
              ) : panel === 'cost' ? (
                <CostSection
                  key={costWindow}
                  cost={data?.cost ?? null}
                  windowKey={costWindow}
                  identifyModel={identifyModel}
                  resolveProjectLabel={resolveProjectLabel}
                />
              ) : panel === 'models' ? (
                data?.models && data.models.last30d.turnCount > 0 ? (
                  <ModelsSection
                    stats={data.models}
                    windowKey={modelWindow}
                    identifyModel={identifyModel}
                  />
                ) : (
                  <ModelsEmpty />
                )
              ) : panel === 'skills' && data?.skills ? (
                <SkillsSection
                  stats={data.skills}
                  windowKey={skillWindow}
                  onSelectSkill={onSelectSkill}
                  onShowInvocations={onShowInvocations}
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
  onChange,
  ariaLabel = 'Activity window'
}: {
  value: ActivityWindowKey
  onChange: (value: ActivityWindowKey) => void
  ariaLabel?: string
}): React.JSX.Element {
  const windows: { key: ActivityWindowKey; label: string }[] = [
    { key: '24h', label: '24 hours' },
    { key: '7d', label: '7 days' },
    { key: '30d', label: '30 days' }
  ]

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
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
  windowKey,
  resolveProjectLabel
}: {
  activity: ActivityStats | null
  windowKey: ActivityWindowKey
  resolveProjectLabel: ProjectLabelResolver
}): React.JSX.Element {
  if (
    activity === null ||
    (activity.last30d.prompts === 0 && activity.last30d.slashCommands === 0)
  ) {
    return <NoHistory unavailable={activity?.last30d.coverage === 'unavailable'} />
  }

  const window = selectActivityWindow(activity, windowKey)
  return (
    <ActivitySection
      win={window}
      windowKey={windowKey}
      hourlyTrend={activity.last24h.hourlyTrend}
      resolveProjectLabel={resolveProjectLabel}
    />
  )
}

function ActivitySection({
  win,
  windowKey,
  hourlyTrend,
  resolveProjectLabel
}: {
  win: ActivityWindow
  windowKey: ActivityWindowKey
  hourlyTrend: ActivityHour[]
  resolveProjectLabel: ProjectLabelResolver
}): React.JSX.Element {
  // An hour is captured whole: rolling hourly buckets shift on every refresh, so re-finding it by
  // key would drop or change an open dialog. A date stays stable and is re-read (as in Cost).
  const [selectedBucket, setSelectedBucket] = useState<
    { kind: 'day'; date: string } | { kind: 'hour'; hour: ActivityHour } | null
  >(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const windowEmpty = win.prompts === 0 && win.slashCommands === 0
  const windowLabel = windowKey === '24h' ? '24 hours' : `${win.days} days`
  const emptyMessage = `No prompts in the last ${windowLabel}`
  const selectedDetails =
    selectedBucket?.kind === 'day'
      ? (win.byDay.find((day) => day.date === selectedBucket.date) ?? null)
      : selectedBucket?.kind === 'hour'
        ? selectedBucket.hour
        : null

  if (win.coverage === 'unavailable' && windowEmpty) return <NoHistory unavailable />

  return (
    <section className="flex flex-col gap-6 py-8">
      {win.coverage && win.coverage !== 'available' && (
        <p className="text-[11px] text-muted-foreground">
          {win.coverage === 'unavailable'
            ? 'Prompt history is unavailable for this period.'
            : 'Partial prompt history for this period.'}{' '}
          Counts describe retained records.
        </p>
      )}
      <StatCells
        activeDays={win.activeDays}
        sessions={win.sessions}
        prompts={win.prompts}
        slashCommands={win.slashCommands}
        days={win.days}
      />

      {windowKey === '24h' ? (
        <ChartBlock label="By hour" empty={windowEmpty} emptyMessage={emptyMessage}>
          <InvocationTrend
            data={hourlyTrend}
            window="24h"
            nounSingular="prompt"
            onSelectBucket={(bucket, _label, trigger) => {
              const hour = hourlyTrend.find((candidate) => candidate.key === bucket.key)
              if (!hour) return
              triggerRef.current = trigger
              setSelectedBucket({ kind: 'hour', hour })
              setDialogOpen(true)
            }}
          />
        </ChartBlock>
      ) : (
        <>
          <ChartBlock label="By day" empty={windowEmpty} emptyMessage={emptyMessage}>
            <DayStrip
              data={win.byDay.map((day) => ({
                date: day.date,
                value: day.count,
                weekday: day.weekday,
                partial: day.partial
              }))}
              days={win.days}
              formatValue={(value) => `${formatCount(value)} prompts`}
              onSelectDay={(day, trigger) => {
                triggerRef.current = trigger
                setSelectedBucket({ kind: 'day', date: day.date })
                setDialogOpen(true)
              }}
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
        <ProjectRankedList
          items={win.byProject.map((project) => ({
            label: resolveProjectLabel(project.project),
            value: project.count,
            fullLabel: project.project
          }))}
          formatValue={formatCount}
          noun="projects"
        />
      </ChartBlock>
      <ActivityDetailsDialog
        bucket={selectedDetails}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onRestoreFocus={() => triggerRef.current?.focus()}
        resolveProjectLabel={resolveProjectLabel}
        coverage={selectedDetails?.coverage}
      />
    </section>
  )
}

function NoHistory({ unavailable = false }: { unavailable?: boolean }): React.JSX.Element {
  return (
    <div className="flex flex-col items-center gap-2 py-24 text-center">
      <Activity className="size-8 text-muted-foreground" />
      <p className="text-[13px] font-medium">
        {unavailable
          ? 'Prompt history unavailable for this period'
          : 'No recorded activity in the last 30 days'}
      </p>
      <p className="max-w-[380px] text-[13px] text-muted-foreground">
        Activity and History share your retained Claude Code prompt history. New prompts appear
        after a rescan; History may contain earlier activity.
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
  if (panel === 'history') {
    return <HistorySkeleton />
  }
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
