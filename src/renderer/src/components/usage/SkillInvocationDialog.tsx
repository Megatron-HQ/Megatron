import { useMemo, useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { TextLink } from '@/components/TextLink'
import { InvocationRow } from '@/components/InvocationRow'
import { parseInvocationPrompt } from '@/lib/invocation-prompt'
import { getFolderBasename, getSkillDisplayName } from '@/lib/source-name'
import { TRIGGER_META } from '@/lib/trigger-meta'
import { cn } from '@/lib/utils'
import type { SkillInvocationRecord, TriggerType } from '../../../../shared/ipc'
import { INVOCATION_PAGE_SIZE } from '../../../../shared/ipc'

export interface SkillInvocationSelection {
  title: string
  startAt: string
  endAt: string
  skillName?: string
  note?: string
}

type TriggerFilter = TriggerType | 'all'

const TRIGGER_FILTERS: { value: TriggerFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'user_invoked', label: TRIGGER_META.user_invoked.label },
  { value: 'autonomous', label: TRIGGER_META.autonomous.label },
  { value: 'subagent', label: TRIGGER_META.subagent.label }
]

function matchesSearch(entry: SkillInvocationRecord, needle: string): boolean {
  const prompt = parseInvocationPrompt(entry.preceding_user_text).label.toLowerCase()
  const project = getFolderBasename(entry.cwd).toLowerCase()
  return (
    prompt.includes(needle) ||
    project.includes(needle) ||
    entry.skillName.toLowerCase().includes(needle)
  )
}

export function SkillInvocationDialog({
  open,
  onOpenChange,
  selection,
  onSelectSkill
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  selection: SkillInvocationSelection
  onSelectSkill: (skillId: number) => void
}): React.JSX.Element {
  const [search, setSearch] = useState('')
  const [triggerFilter, setTriggerFilter] = useState<TriggerFilter>('all')
  const {
    data,
    isPending,
    isError,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
    isFetchNextPageError
  } = useInfiniteQuery({
    queryKey: ['usage-skill-invocations', selection.startAt, selection.endAt, selection.skillName],
    queryFn: ({ pageParam }) =>
      window.api.getUsageSkillInvocations({ ...selection, offset: pageParam }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) =>
      lastPage.length === INVOCATION_PAGE_SIZE ? pages.length * INVOCATION_PAGE_SIZE : undefined,
    enabled: open
  })
  const entries = useMemo(() => data?.pages.flat() ?? [], [data])
  const needle = search.trim().toLowerCase()
  const filtered = useMemo(
    () =>
      entries.filter(
        (entry) =>
          (triggerFilter === 'all' || entry.trigger_type === triggerFilter) &&
          (needle === '' || matchesSearch(entry, needle))
      ),
    [entries, triggerFilter, needle]
  )
  const isFiltering = needle !== '' || triggerFilter !== 'all'
  const countLabel = isFiltering
    ? `${filtered.length.toLocaleString()} of ${entries.length.toLocaleString()} invocations`
    : `${entries.length.toLocaleString()} ${entries.length === 1 ? 'invocation' : 'invocations'}`

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="truncate pr-6">{selection.title} · Skill invocations</DialogTitle>
          <DialogDescription className="font-mono tabular-nums">{countLabel}</DialogDescription>
        </DialogHeader>
        {hasNextPage && (
          <p className="text-xs text-muted-foreground">
            Showing loaded invocations. Search and filters apply to these entries.
          </p>
        )}
        {selection.note && <p className="text-[12px] text-muted-foreground">{selection.note}</p>}
        <div className="flex min-w-0 flex-col gap-2">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search invocations…"
            aria-label="Search invocations"
          />
          <div
            role="radiogroup"
            aria-label="Filter by trigger type"
            className="grid grid-cols-4 gap-1 rounded-md border border-border p-1"
          >
            {TRIGGER_FILTERS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={triggerFilter === value}
                onClick={() => setTriggerFilter(value)}
                className={cn(
                  'rounded-sm px-2 py-1.5 text-sm transition-colors',
                  triggerFilter === value
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {isPending ? (
          <div className="flex flex-col gap-2 border-t border-border pt-3">
            {[0, 1, 2].map((index) => (
              <Skeleton key={index} className="h-14 w-full" />
            ))}
          </div>
        ) : isError && entries.length === 0 ? (
          <p className="border-t border-border pt-3 text-sm text-muted-foreground">
            Could not load skill invocations.
          </p>
        ) : filtered.length === 0 ? (
          <p className="border-t border-border pt-3 text-sm text-muted-foreground">
            {entries.length === 0
              ? 'No recorded invocations in this period.'
              : 'No invocations match your filters.'}
          </p>
        ) : (
          <div className="min-w-0 divide-y divide-border border-t border-border">
            {filtered.map((entry, index) => {
              const label = getSkillDisplayName(entry.skillName, entry.sourceType)
              return (
                <div
                  key={`${entry.invoked_at}-${entry.skillName}-${index}`}
                  className="min-w-0 py-1"
                >
                  <div className="flex min-w-0 items-center gap-2 pl-[3.25rem]">
                    {entry.skillId === null ? (
                      <span className="truncate text-[12px] font-medium" title={entry.skillName}>
                        {label}
                      </span>
                    ) : (
                      <TextLink
                        className="min-w-0 truncate text-[12px] font-medium"
                        aria-label={`Open ${label} detail`}
                        onClick={() => onSelectSkill(entry.skillId as number)}
                        title={entry.skillName}
                      >
                        {label}
                      </TextLink>
                    )}
                    {entry.sourceType && (
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {entry.sourceType}
                      </span>
                    )}
                    <span className="min-w-0 truncate text-[11px] text-muted-foreground">
                      · {getFolderBasename(entry.cwd) || entry.cwd}
                    </span>
                  </div>
                  <InvocationRow entry={entry} />
                </div>
              )
            })}
          </div>
        )}
        {(hasNextPage || isFetchNextPageError) && (
          <div className="border-t border-border pt-3">
            {isFetchNextPageError && (
              <p role="status" className="mb-2 text-xs text-muted-foreground">
                Could not load more invocations. Try again.
              </p>
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={isFetchingNextPage}
              onClick={() => void fetchNextPage()}
            >
              {isFetchingNextPage ? 'Loading…' : 'Load more invocations'}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
