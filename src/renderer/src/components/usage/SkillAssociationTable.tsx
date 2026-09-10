import { useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { SkillCostAssociation } from '../../../../shared/ipc'
import { TextLink } from '@/components/TextLink'
import { formatCount, formatUsd } from './chart-utils'

const INITIAL_ROWS = 8

function AssociationRow({
  row,
  maxCost,
  onSelectSkill
}: {
  row: SkillCostAssociation
  maxCost: number
  onSelectSkill?: (skillId: number) => void
}): React.JSX.Element {
  const pct = maxCost > 0 ? (row.associatedCostUsd / maxCost) * 100 : 0
  const clickable = row.skillId !== null && onSelectSkill !== undefined

  return (
    <tr className="group relative h-8 border-b border-border last:border-b-0">
      {/* ponytail: absolute fill anchors to the position:relative <tr> — table rows as containing
          blocks are Chromium-only, which is all Megatron ships (macOS-only Electron). */}
      <td className="max-w-0 pr-4">
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 bg-usage-bar/[0.07] transition-colors duration-150 group-hover:bg-usage-bar/[0.11] dark:bg-usage-bar/[0.12] dark:group-hover:bg-usage-bar/[0.17]"
          style={{ width: `${pct}%`, minWidth: row.associatedCostUsd > 0 ? 2 : undefined }}
        />
        {/* TextLink carries no flex-1: it shrink-wraps its text so the underline sweep spans the
            word, not the whole cell. min-w-0 still lets a long name truncate. */}
        <span className="relative flex min-w-0 items-center gap-1.5">
          {clickable ? (
            <TextLink
              className="min-w-0 text-[13px]"
              onClick={() => onSelectSkill?.(row.skillId as number)}
            >
              <span className="truncate" title={row.skillName}>
                {row.skillName}
              </span>
            </TextLink>
          ) : (
            <span className="truncate text-[13px]" title={row.skillName}>
              {row.skillName}
            </span>
          )}
          {row.sourceType && (
            <span className="shrink-0 text-[11px] text-muted-foreground">{row.sourceType}</span>
          )}
        </span>
      </td>
      <td
        className="relative w-28 text-right font-mono text-[12px] tabular-nums text-muted-foreground"
        title={`${row.trackedSessionCount} of ${row.sessionCount} sessions have usable cost data`}
      >
        {formatCount(row.trackedSessionCount)} / {formatCount(row.sessionCount)}
      </td>
      <td className="relative w-32 text-right font-mono text-[12px] tabular-nums text-muted-foreground">
        {formatCount(row.associatedOutputTokens)}
      </td>
      <td className="relative w-28 text-right font-mono text-[12px] tabular-nums text-foreground">
        {row.trackedSessionCount === 0 ? '—' : formatUsd(row.associatedCostUsd, { cents: true })}
      </td>
    </tr>
  )
}

export function SkillAssociationTable({
  rows,
  pricedSessionsWithoutSkill,
  onSelectSkill
}: {
  rows: SkillCostAssociation[]
  pricedSessionsWithoutSkill: number
  onSelectSkill?: (skillId: number) => void
}): React.JSX.Element {
  const reduceMotion = useReducedMotion() === true
  const [expanded, setExpanded] = useState(false)
  const visibleRows = expanded ? rows : rows.slice(0, INITIAL_ROWS)
  const hiddenCount = Math.max(0, rows.length - INITIAL_ROWS)
  const maxCost = rows.reduce((max, row) => Math.max(max, row.associatedCostUsd), 0)
  const n = pricedSessionsWithoutSkill

  return (
    <div className="flex flex-col gap-2">
      <p className="max-w-[520px] text-[11px] text-muted-foreground">
        Association, not attribution. Each session is counted under every skill it invoked, so these
        rows overlap and add up to more than the tracked-window total. This shows which skills tend
        to run inside expensive sessions &mdash; not what a skill &ldquo;costs.&rdquo;
      </p>
      {n > 0 && (
        <p className="max-w-[520px] text-[11px] text-muted-foreground">
          {n.toLocaleString()} cost-tracked {n === 1 ? 'session' : 'sessions'} invoked no skill and{' '}
          {n === 1 ? "isn't" : "aren't"} shown here &mdash; counted across all tracked history, not
          the selected window.
        </p>
      )}
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
              <AssociationRow
                key={row.skillName}
                row={row}
                maxCost={maxCost}
                onSelectSkill={onSelectSkill}
              />
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
