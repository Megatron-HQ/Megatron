import { ChevronRight, Gauge } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { heaviestBudgetSkills } from '@/lib/context-budget'
import { SOURCE_ICON, SYNCED_ICON } from '@/lib/source-icon'
import type { ContextBudget, SkillRow } from '../../../shared/ipc'

interface ContextBudgetDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  budget: ContextBudget
  skills: SkillRow[]
  onSelectSkill: (id: number) => void
  onViewDisabled: () => void
}

export function ContextBudgetDialog({
  open,
  onOpenChange,
  budget,
  skills,
  onSelectSkill,
  onViewDisabled
}: ContextBudgetDialogProps): React.JSX.Element {
  const heaviest = heaviestBudgetSkills(skills)
  const over = budget.limit > 0 && budget.used > budget.limit
  const delta = Math.abs(budget.used - budget.limit)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-mono text-base font-semibold tabular-nums">
            {budget.used.toLocaleString()} estimated tokens
          </DialogTitle>
          <DialogDescription>What this number means?</DialogDescription>
          <p className="max-w-[72ch] text-left text-[13px] leading-relaxed text-muted-foreground">
            Sum of every <em>enabled</em> global and plugin skill&apos;s name and description: the
            part of a skill Claude Code always keeps in context, whether or not the skill ever runs.
            Claude Code budgets this listing at{' '}
            <span className="font-mono tabular-nums text-foreground">
              {budget.limit.toLocaleString()}
            </span>{' '}
            tokens, roughly 1% of a 200K-token reference window. Project skills aren&apos;t counted
            here; they only load inside their own repo.
          </p>
        </DialogHeader>

        <div className="flex flex-col gap-2 border-t border-border pt-2">
          <p className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
            <Gauge className="size-3.5 shrink-0" />
            {delta.toLocaleString()} tokens {over ? 'over budget' : 'under budget'}
          </p>
          <p className="max-w-[72ch] text-left text-[13px] leading-relaxed text-muted-foreground">
            Claude Code doesn&apos;t drop skills over budget: it strips descriptions starting with
            your least-used skills, which can make a skill harder for Claude to find or route to
            correctly.
          </p>
          <p className="text-[13px] text-muted-foreground">
            Run <span className="font-mono text-foreground">/skills</span> to disable ones you
            don&apos;t use.
          </p>
          <p className="text-[13px] text-muted-foreground">
            Or raise <span className="font-mono text-foreground">skillListingBudgetFraction</span>{' '}
            in settings.json.
          </p>
          {budget.excludedCount > 0 && (
            <p className="flex flex-wrap items-center gap-x-1.5 text-[13px] text-muted-foreground">
              <span>
                {budget.excludedCount.toLocaleString()}{' '}
                {budget.excludedCount === 1 ? 'disabled skill' : 'disabled skills'} (
                {budget.excludedTokens.toLocaleString()} tokens) excluded.
              </span>
              <button
                type="button"
                onClick={() => {
                  onViewDisabled()
                  onOpenChange(false)
                }}
                className="font-medium text-foreground underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none"
              >
                View disabled skills
              </button>
            </p>
          )}
        </div>

        {heaviest.length > 0 ? (
          <div className="border-t border-border pt-2">
            <p className="px-1 pb-1 text-[11px] font-medium tracking-[0.04em] text-muted-foreground uppercase">
              Never used, heaviest first
            </p>
            <div className="flex flex-col">
              {heaviest.map((skill) => {
                const isSynced = skill.is_synced === 1
                const Icon = isSynced ? SYNCED_ICON : SOURCE_ICON[skill.source_type]
                const uses = skill.total_invocations
                const usesLabel =
                  uses === 0 ? 'Never' : `${uses.toLocaleString()} ${uses === 1 ? 'use' : 'uses'}`
                return (
                  <button
                    key={skill.id}
                    type="button"
                    onClick={() => {
                      onSelectSkill(skill.id)
                      onOpenChange(false)
                    }}
                    className="flex items-center gap-2 rounded-md px-1 py-1.5 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                  >
                    <Icon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="flex-1 truncate">{skill.name}</span>
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">
                      {skill.est_listing_tokens.toLocaleString()} tokens ({usesLabel})
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                  </button>
                )
              })}
            </div>
          </div>
        ) : (
          <p className="border-t border-border pt-2 text-sm text-muted-foreground">
            No skills scanned yet.
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}
