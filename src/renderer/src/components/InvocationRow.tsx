import { useState } from 'react'
import { ChevronDown, ChevronRight, Image as ImageIcon } from 'lucide-react'
import { parseInvocationPrompt } from '@/lib/invocation-prompt'
import { formatRelativeTime } from '@/lib/relative-time'
import { getFolderBasename } from '@/lib/source-name'
import { TRIGGER_META } from '@/lib/trigger-meta'
import { cn } from '@/lib/utils'
import type { SkillInvocationEntry } from '../../../shared/ipc'

// One accordion row of a skill's invocation history. Rendered by both the Detail page's
// recent-five list and SkillActivityDialog's full log. The stored prompt is routed through
// parseInvocationPrompt so an image-caption placeholder shows as a labelled row rather than
// its raw "[Image: original …]" string.
export function InvocationRow({ entry }: { entry: SkillInvocationEntry }): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const { label: triggerLabel, Icon } = TRIGGER_META[entry.trigger_type]
  const prompt = parseInvocationPrompt(entry.preceding_user_text)
  const isCommand = prompt.kind === 'text' && prompt.label.startsWith('/')
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
        {prompt.kind === 'image' ? (
          <span className="flex min-w-0 flex-1 items-center gap-1.5 text-muted-foreground">
            <ImageIcon className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">
              {prompt.label} · {prompt.dimensions}
            </span>
          </span>
        ) : (
          <span
            className={cn(
              'min-w-0 flex-1 break-words text-foreground',
              !expanded && 'line-clamp-2',
              isCommand && 'font-mono text-xs'
            )}
          >
            {prompt.label}
          </span>
        )}
        <time
          className="mt-px shrink-0 text-[11px] text-muted-foreground"
          dateTime={entry.invoked_at}
          title={new Date(entry.invoked_at).toLocaleString()}
        >
          {formatRelativeTime(entry.invoked_at)}
        </time>
      </button>

      {expanded && (
        <dl className="mt-2 grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 pl-[3.25rem] text-[11px]">
          <dt className="text-muted-foreground">Project</dt>
          <dd className="min-w-0 break-words text-foreground">
            {getFolderBasename(entry.cwd) || entry.cwd}
            {entry.git_branch !== null && (
              <span className="text-muted-foreground"> · {entry.git_branch}</span>
            )}
          </dd>
          <dt className="text-muted-foreground">When</dt>
          <dd className="text-foreground">{new Date(entry.invoked_at).toLocaleString()}</dd>
          {entry.trigger_type === 'subagent' && entry.agent_id !== null && (
            <>
              <dt className="text-muted-foreground">Subagent</dt>
              <dd className="min-w-0 break-words font-mono text-foreground">{entry.agent_id}</dd>
            </>
          )}
        </dl>
      )}
    </div>
  )
}
