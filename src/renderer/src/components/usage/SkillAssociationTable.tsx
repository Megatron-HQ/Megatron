import { useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { SkillCostAssociation } from '../../../../shared/ipc'
import { formatCount, formatUsd } from './chart-utils'

const INITIAL_ROWS = 8

function AssociationRow({ row }: { row: SkillCostAssociation }): React.JSX.Element {
  return (
    <tr className="h-8 border-b border-border last:border-b-0">
      <td className="max-w-0 truncate pr-4 text-[13px]" title={row.skillName}>
        {row.skillName}
      </td>
      <td
        className="w-28 text-right font-mono text-[12px] tabular-nums text-muted-foreground"
        title={`${row.trackedSessionCount} of ${row.sessionCount} sessions have usable cost data`}
      >
        {formatCount(row.trackedSessionCount)} / {formatCount(row.sessionCount)}
      </td>
      <td className="w-32 text-right font-mono text-[12px] tabular-nums text-muted-foreground">
        {formatCount(row.associatedOutputTokens)}
      </td>
      <td className="w-28 text-right font-mono text-[12px] tabular-nums text-muted-foreground">
        {row.trackedSessionCount === 0 ? '—' : formatUsd(row.associatedCostUsd, { cents: true })}
      </td>
    </tr>
  )
}

export function SkillAssociationTable({
  rows
}: {
  rows: SkillCostAssociation[]
}): React.JSX.Element {
  const reduceMotion = useReducedMotion() === true
  const [expanded, setExpanded] = useState(false)
  const visibleRows = expanded ? rows : rows.slice(0, INITIAL_ROWS)
  const hiddenCount = Math.max(0, rows.length - INITIAL_ROWS)

  return (
    <div className="flex flex-col gap-2">
      <p className="max-w-[680px] text-[11px] text-muted-foreground">
        Association, not attribution. Each row totals whole sessions that invoked the skill;
        sessions can appear in more than one row.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] table-fixed text-left">
          <thead>
            <tr className="h-7 border-b border-border text-[11px] font-medium uppercase tracking-[0.04em] text-muted-foreground">
              <th className="pr-4 font-medium">Skill</th>
              <th className="w-28 text-right font-medium">Tracked / all</th>
              <th className="w-32 text-right font-medium">Output tokens</th>
              <th className="w-28 text-right font-medium">Associated cost</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => (
              <AssociationRow key={row.skillName} row={row} />
            ))}
          </tbody>
        </table>
      </div>

      <AnimatePresence initial={false}>
        {hiddenCount > 0 && (
          <motion.button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            className="self-start text-[11px] font-medium uppercase tracking-[0.04em] text-muted-foreground hover:text-foreground"
            initial={reduceMotion ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: reduceMotion ? 0 : 0.15 }}
          >
            {expanded ? 'Show fewer' : `+ ${hiddenCount} more skills`}
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  )
}
