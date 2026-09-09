import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useState } from 'react'
import { ChartBlock } from './ChartBlock'
import { InvocationTrend } from './InvocationTrend'
import { RankedList } from './RankedList'
import { SkillAssociationTable } from './SkillAssociationTable'
import { formatCount } from './chart-utils'
import { cn } from '@/lib/utils'
import type {
  SkillStats,
  SkillStatsWindow,
  SkillStatsWindowKey,
  TriggerType
} from '../../../../shared/ipc'

const WINDOWS: { key: SkillStatsWindowKey; label: string }[] = [
  { key: '24h', label: '24 hours' },
  { key: '7d', label: '7 days' },
  { key: '30d', label: '30 days' }
]

const TRIGGER_LABELS: Record<TriggerType, string> = {
  user_invoked: 'User-invoked',
  autonomous: 'Autonomous',
  subagent: 'Subagent'
}

function selectedWindow(stats: SkillStats, key: SkillStatsWindowKey): SkillStatsWindow {
  if (key === '24h') return stats.last24h
  if (key === '7d') return stats.last7d
  return stats.last30d
}

function SkillWindowToggle({
  value,
  onChange
}: {
  value: SkillStatsWindowKey
  onChange: (value: SkillStatsWindowKey) => void
}): React.JSX.Element {
  return (
    <div
      role="radiogroup"
      aria-label="Skill activity window"
      className="flex gap-1 rounded-md border border-border p-0.5"
    >
      {WINDOWS.map(({ key, label }) => {
        const active = key === value
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(key)}
            className={cn(
              'rounded-sm px-2 py-0.5 text-[12px] transition-colors',
              active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}

function SkillStat({
  label,
  value,
  window,
  reduceMotion
}: {
  label: string
  value: number
  window: SkillStatsWindowKey
  reduceMotion: boolean
}): React.JSX.Element {
  return (
    <div className="flex min-w-24 flex-col gap-1">
      <div className="h-[33px] overflow-hidden">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={window}
            className="block text-usage-stat text-foreground"
            initial={reduceMotion ? false : { y: 12, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { y: -12, opacity: 0 }}
            transition={reduceMotion ? { duration: 0 } : { duration: 0.32, ease: 'easeOut' }}
          >
            {formatCount(value)}
          </motion.span>
        </AnimatePresence>
      </div>
      <span className="text-[11px] font-medium uppercase tracking-[0.04em] text-muted-foreground">
        {label}
      </span>
    </div>
  )
}

export function SkillsSection({ stats }: { stats: SkillStats }): React.JSX.Element {
  const reduceMotion = useReducedMotion() === true
  const [windowKey, setWindowKey] = useState<SkillStatsWindowKey>('30d')
  const window = selectedWindow(stats, windowKey)
  const emptyMessage = `No skill invocations in the last ${windowKey === '24h' ? '24 hours' : windowKey === '7d' ? '7 days' : '30 days'}`
  const empty = window.invocationCount === 0

  return (
    <motion.section
      className="flex flex-col gap-6 border-t border-border py-8"
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.12 }}
      transition={reduceMotion ? { duration: 0 } : { duration: 0.32, ease: 'easeOut' }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[13px] font-semibold">Skills</h2>
        <SkillWindowToggle value={windowKey} onChange={setWindowKey} />
      </div>

      <div className="flex flex-wrap items-start gap-x-10 gap-y-4">
        <SkillStat
          label="Invocations"
          value={window.invocationCount}
          window={windowKey}
          reduceMotion={reduceMotion}
        />
        <span aria-hidden className="mt-1 hidden h-9 w-px bg-border sm:block" />
        <SkillStat
          label="Skills used"
          value={window.skillCount}
          window={windowKey}
          reduceMotion={reduceMotion}
        />
        <span aria-hidden className="mt-1 hidden h-9 w-px bg-border sm:block" />
        <SkillStat
          label="Sessions"
          value={window.sessionCount}
          window={windowKey}
          reduceMotion={reduceMotion}
        />
      </div>

      <ChartBlock label="Invocations over time" empty={empty} emptyMessage={emptyMessage}>
        <InvocationTrend data={window.trend} window={windowKey} />
      </ChartBlock>

      <ChartBlock label="Top skills" empty={empty} emptyMessage={emptyMessage}>
        <RankedList
          items={window.bySkill.map((row) => ({
            label: row.skillName,
            fullLabel: row.skillName,
            value: row.count
          }))}
          formatValue={formatCount}
          noun="skills"
        />
      </ChartBlock>

      <ChartBlock label="How they were invoked" empty={empty} emptyMessage={emptyMessage}>
        <RankedList
          items={window.byTriggerType.map((row) => ({
            label: TRIGGER_LABELS[row.trigger_type],
            fullLabel: TRIGGER_LABELS[row.trigger_type],
            value: row.count
          }))}
          formatValue={formatCount}
          noun="trigger types"
        />
      </ChartBlock>

      <ChartBlock label="Session association" empty={empty} emptyMessage={emptyMessage}>
        <SkillAssociationTable rows={window.associations} />
      </ChartBlock>
    </motion.section>
  )
}
