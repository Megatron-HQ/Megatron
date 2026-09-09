import { useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { TextLink } from '@/components/TextLink'
import type { SkillAssociationRow } from '../../../../shared/ipc'
import { formatCount, formatUsd } from './chart-utils'

const TOP_N = 8

// Grid shared by the header and every row so the four columns stay aligned. Skill flexes and
// truncates; the three numeric columns are fixed-width right rails.
const GRID = 'grid grid-cols-[minmax(0,1fr)_5.5rem_5rem_5.5rem] items-center gap-2'

interface AssocTableProps {
  rows: SkillAssociationRow[] // pre-sorted (est. cost desc) by the query
  onSelectSkill?: (skillId: number) => void
}

// "Skills by associated spend" (docs/usage-view-ui-spec.md §D). A static 4-column table — NOT
// @tanstack/react-table (that's scoped to the skills inventory) and NOT RankedList (2-column,
// shared with Activity + Cost). Ambient --usage-bar row-fill keyed to est. cost, reusing
// RankedList's exact tint treatment (§C4 / §C-3).
export function AssocTable({ rows, onSelectSkill }: AssocTableProps): React.JSX.Element {
  const reduceMotion = useReducedMotion() === true
  const [expanded, setExpanded] = useState(false)

  const maxCost = rows.reduce((max, row) => Math.max(max, row.estCostUsd), 0)
  const head = rows.slice(0, TOP_N)
  const rest = rows.slice(TOP_N)
  const restCost = rest.reduce((sum, row) => sum + row.estCostUsd, 0)

  const dataRow = (row: SkillAssociationRow, index: number): React.JSX.Element => {
    const pct = maxCost > 0 ? (row.estCostUsd / maxCost) * 100 : 0
    const clickable = row.skillId !== null && onSelectSkill !== undefined
    return (
      <motion.div
        key={row.skillName}
        className={`group relative h-7 border-b border-border last:border-b-0 ${GRID}`}
        initial={reduceMotion ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={
          reduceMotion ? { duration: 0 } : { duration: 0.2, delay: Math.min(index * 0.02, 0.2) }
        }
      >
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 bg-usage-bar/[0.07] transition-colors duration-150 group-hover:bg-usage-bar/[0.11] dark:bg-usage-bar/[0.12] dark:group-hover:bg-usage-bar/[0.17]"
          style={{ width: `${pct}%`, minWidth: row.estCostUsd > 0 ? 2 : undefined }}
        />
        <div className="relative flex min-w-0 items-center gap-1.5">
          {clickable ? (
            <TextLink
              className="min-w-0 text-[13px]"
              onClick={() => onSelectSkill(row.skillId as number)}
            >
              <span className="truncate">{row.skillName}</span>
            </TextLink>
          ) : (
            <span className="truncate text-[13px]">{row.skillName}</span>
          )}
          {row.sourceType && (
            <span className="shrink-0 text-[11px] text-muted-foreground">{row.sourceType}</span>
          )}
        </div>
        <span className="relative text-right font-mono text-[12px] tabular-nums text-muted-foreground">
          {formatCount(row.invocations)}
        </span>
        <span className="relative text-right font-mono text-[12px] tabular-nums text-muted-foreground">
          {formatCount(row.sessions)}
        </span>
        <span className="relative text-right font-mono text-[12px] tabular-nums">
          {formatUsd(row.estCostUsd, { cents: true })}
        </span>
      </motion.div>
    )
  }

  return (
    <div className="flex flex-col">
      <div
        className={`${GRID} border-b border-border pb-1 text-[11px] font-medium uppercase tracking-[0.04em] text-muted-foreground`}
      >
        <span>Skill</span>
        <span className="text-right">Invocations</span>
        <span className="text-right">Sessions</span>
        <span className="text-right">Est. cost</span>
      </div>

      {head.map(dataRow)}

      <AnimatePresence initial={false}>
        {expanded && rest.length > 0 && (
          <motion.div
            className="overflow-hidden"
            initial={reduceMotion ? false : { height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
          >
            {rest.map((row, i) => dataRow(row, TOP_N + i))}
          </motion.div>
        )}
      </AnimatePresence>

      {rest.length > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="mt-1 self-start text-[11px] font-medium uppercase tracking-[0.04em] text-muted-foreground hover:text-foreground"
        >
          {expanded
            ? 'Show fewer'
            : `+ ${rest.length} more skills · ${formatUsd(restCost, { cents: true })}`}
        </button>
      )}
    </div>
  )
}
