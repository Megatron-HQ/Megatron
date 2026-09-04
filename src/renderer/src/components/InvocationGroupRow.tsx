import { useState } from 'react'
import { ChevronDown, ChevronRight, Image as ImageIcon } from 'lucide-react'
import { parseInvocationPrompt } from '@/lib/invocation-prompt'
import { formatRelativeTime } from '@/lib/relative-time'
import { TRIGGER_META } from '@/lib/trigger-meta'
import type { SkillInvocationEntry } from '../../../shared/ipc'

// One accordion row summarizing a run of image-only invocations (see invocation-grouping.ts) —
// same structure as InvocationRow so the two read as one list, but the label is a count + time
// range instead of a per-row dimension, since dimensions don't distinguish rows within a run.
export function InvocationGroupRow({
  entries
}: {
  entries: SkillInvocationEntry[]
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const { label: triggerLabel, Icon } = TRIGGER_META[entries[0].trigger_type]
  const newest = entries[0]
  const oldest = entries[entries.length - 1]
  const timeRange = `${formatClockTime(oldest.invoked_at)}–${formatClockTime(newest.invoked_at)}`
  const Chevron = expanded ? ChevronDown : ChevronRight

  return (
    <div className="min-w-0 py-2 text-[13px]">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-start gap-2 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <Chevron className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        <Icon
          className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
          aria-label={triggerLabel}
        />
        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-muted-foreground">
          <ImageIcon className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">
            {entries.length} screenshots · {timeRange}
          </span>
        </span>
        <time
          className="mt-px shrink-0 text-[11px] text-muted-foreground"
          dateTime={newest.invoked_at}
          title={new Date(newest.invoked_at).toLocaleString()}
        >
          {formatRelativeTime(newest.invoked_at)}
        </time>
      </button>

      {expanded && (
        <ul className="mt-2 space-y-1 pl-[3.25rem] text-[11px] text-muted-foreground">
          {entries.map((entry, index) => {
            const prompt = parseInvocationPrompt(entry.preceding_user_text)
            return (
              <li key={index}>
                {formatClockTime(entry.invoked_at)}
                {prompt.kind === 'image' && ` · ${prompt.dimensions}`}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function formatClockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString()
}
