import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { InvocationRow } from '@/components/InvocationRow'
import { parseInvocationPrompt } from '@/lib/invocation-prompt'
import { getFolderBasename } from '@/lib/source-name'
import { TRIGGER_META } from '@/lib/trigger-meta'
import { cn } from '@/lib/utils'
import type { SkillInvocationEntry, TriggerType } from '../../../shared/ipc'

interface SkillActivityDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  skillId: number
  skillName: string
}

type TriggerFilter = TriggerType | 'all'

const TRIGGER_FILTERS: { value: TriggerFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'user_invoked', label: TRIGGER_META.user_invoked.label },
  { value: 'autonomous', label: TRIGGER_META.autonomous.label },
  { value: 'subagent', label: TRIGGER_META.subagent.label }
]

// Case-insensitive substring over what the row actually shows — the parsed label ('Image
// attachment' for a screenshot placeholder, never its raw text) and the project basename.
// Matching the raw string would let "coordinates" silently hit every image row.
function matchesSearch(entry: SkillInvocationEntry, needle: string): boolean {
  const label = parseInvocationPrompt(entry.preceding_user_text).label.toLowerCase()
  const project = getFolderBasename(entry.cwd).toLowerCase()
  return label.includes(needle) || project.includes(needle)
}

export function SkillActivityDialog({
  open,
  onOpenChange,
  skillId,
  skillName
}: SkillActivityDialogProps): React.JSX.Element {
  const [search, setSearch] = useState('')
  const [triggerFilter, setTriggerFilter] = useState<TriggerFilter>('all')

  const { data: entries = [] } = useQuery({
    queryKey: ['skill-history', skillId],
    queryFn: () => window.api.openSkillHistory(skillId),
    enabled: open
  })

  const needle = search.trim().toLowerCase()
  const isFiltering = needle !== '' || triggerFilter !== 'all'

  const filtered = useMemo(
    () =>
      entries.filter(
        (entry) =>
          (triggerFilter === 'all' || entry.trigger_type === triggerFilter) &&
          (needle === '' || matchesSearch(entry, needle))
      ),
    [entries, triggerFilter, needle]
  )

  const countLabel = isFiltering
    ? `${filtered.length.toLocaleString()} of ${entries.length.toLocaleString()}`
    : `${entries.length.toLocaleString()} ${entries.length === 1 ? 'invocation' : 'invocations'}`

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="truncate pr-6">{skillName} · Activity</DialogTitle>
          <DialogDescription className="font-mono tabular-nums">{countLabel}</DialogDescription>
        </DialogHeader>

        <div className="flex min-w-0 flex-col gap-2">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search activity…"
            aria-label="Search activity"
          />
          <div
            role="radiogroup"
            aria-label="Filter by trigger type"
            className="grid grid-cols-4 gap-1 rounded-md border border-border p-1"
          >
            {TRIGGER_FILTERS.map(({ value, label }) => {
              const active = value === triggerFilter
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setTriggerFilter(value)}
                  className={cn(
                    'rounded-sm px-2 py-1.5 text-sm transition-colors',
                    active
                      ? 'bg-muted text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>

        {filtered.length > 0 ? (
          <div className="min-w-0 divide-y divide-border border-t border-border">
            {filtered.map((entry, index) => (
              <InvocationRow key={index} entry={entry} />
            ))}
          </div>
        ) : (
          <p className="border-t border-border pt-3 text-sm text-muted-foreground">
            {entries.length === 0
              ? 'No recorded activity yet.'
              : 'No activity matches your search.'}
          </p>
        )}
      </DialogContent>
    </Dialog>
  )
}
