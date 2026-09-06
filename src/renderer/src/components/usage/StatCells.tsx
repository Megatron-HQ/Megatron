import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { formatCount } from './chart-utils'

interface StatCellsProps {
  activeDays: number
  sessions: number
  prompts: number
  slashCommands: number
  days: 7 | 30
}

// 3 primary cells, no cards/borders (Ledger-Lies-Flat). The numeral rolls on a window switch
// only — `days` keys the animation, and on mount there is no previous key so nothing rolls.
export function StatCells({
  activeDays,
  sessions,
  prompts,
  slashCommands,
  days
}: StatCellsProps): React.JSX.Element {
  const reduceMotion = useReducedMotion() === true

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start gap-x-10 gap-y-4">
        <Stat label="Active days" value={activeDays} days={days} reduceMotion={reduceMotion} />
        <Divider />
        <Stat label="Sessions" value={sessions} days={days} reduceMotion={reduceMotion} />
        <Divider />
        <Stat label="Prompts" value={prompts} days={days} reduceMotion={reduceMotion} />
      </div>
      <p className="text-[13px] text-muted-foreground">
        + {formatCount(slashCommands)} bare slash-command{slashCommands === 1 ? '' : 's'} (
        <span className="font-mono text-[12px]">/clear</span>,{' '}
        <span className="font-mono text-[12px]">/quit</span>) — not counted as prompts
      </p>
    </div>
  )
}

function Divider(): React.JSX.Element {
  return <span aria-hidden className="mt-1 hidden h-9 w-px bg-border sm:block" />
}

function Stat({
  label,
  value,
  days,
  reduceMotion
}: {
  label: string
  value: number
  days: 7 | 30
  reduceMotion: boolean
}): React.JSX.Element {
  return (
    <div className="flex min-w-[72px] flex-col gap-1">
      <div className="h-[33px] overflow-hidden">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={days}
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
