import {
  Ban,
  CircleCheck,
  CircleDashed,
  CircleHelp,
  CircleX,
  Clock,
  Info,
  KeyRound,
  Power,
  TriangleAlert
} from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { formatRelativeTime } from '@/lib/relative-time'
import type { McpLiveStatus, McpServerRow } from '../../../shared/ipc'

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

// Lint findings; whether a server connects is McpConnectionBadge's. Notices stay muted ink: the
// info tone is reserved for updates (DESIGN.md, Status tones).
export function McpStatusBadge({ server }: { server: McpServerRow }): React.JSX.Element {
  const { Icon, iconClass, label, tooltip } = server.pluginDisabled
    ? {
        Icon: Power,
        iconClass: 'text-dormant',
        label: 'Disabled',
        tooltip: 'Its plugin is switched off everywhere, so Claude Code never loads it.'
      }
    : server.warnings > 0
      ? {
          Icon: TriangleAlert,
          iconClass: 'text-warning',
          label: plural(server.warnings, 'warning'),
          tooltip: `${plural(server.warnings, 'warning')}${server.notices > 0 ? `, ${plural(server.notices, 'notice')}` : ''}`
        }
      : server.notices > 0
        ? {
            Icon: Info,
            iconClass: 'text-muted-foreground',
            label: plural(server.notices, 'notice'),
            tooltip: plural(server.notices, 'notice')
          }
        : { Icon: CircleCheck, iconClass: 'text-success', label: 'OK', tooltip: 'No findings' }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="inline-flex cursor-default items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-foreground select-none">
          <Icon aria-hidden="true" className={cn('size-3 shrink-0', iconClass)} />
          <span className="truncate">{label}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="top">{tooltip}</TooltipContent>
    </Tooltip>
  )
}

const CONNECTION: Record<
  McpLiveStatus,
  { Icon: typeof CircleCheck; iconClass: string; label: string; meaning: string }
> = {
  connected: {
    Icon: CircleCheck,
    iconClass: 'text-success',
    label: 'Connected',
    meaning: 'Claude Code connected and listed its tools.'
  },
  degraded: {
    Icon: TriangleAlert,
    iconClass: 'text-warning',
    label: 'Tools failed',
    meaning: 'Claude Code connected, but listing its tools failed.'
  },
  needs_auth: {
    Icon: KeyRound,
    iconClass: 'text-warning',
    label: 'Needs sign-in',
    meaning: 'Sign in with /mcp in Claude Code, or for a claude.ai connector, at claude.ai.'
  },
  failed: {
    Icon: CircleX,
    iconClass: 'text-destructive',
    label: 'Failed',
    meaning: "Claude Code couldn't connect. Run claude mcp get with its name for the error."
  },
  pending_approval: {
    Icon: Clock,
    iconClass: 'text-muted-foreground',
    label: 'Pending approval',
    meaning: 'A project server nobody approved yet. Claude Code asks when it next starts there.'
  },
  rejected: {
    Icon: Ban,
    iconClass: 'text-dormant',
    label: 'Rejected',
    meaning: 'Listed in disabledMcpjsonServers, so Claude Code never loads it.'
  },
  disabled: {
    Icon: Power,
    iconClass: 'text-dormant',
    label: 'Disabled',
    meaning: 'Switched off for this project with /mcp.'
  },
  not_configured: {
    Icon: CircleHelp,
    iconClass: 'text-muted-foreground',
    label: 'Not configured',
    meaning: 'Claude Code reported it as not configured.'
  }
}

// What the last connection check reported (docs/mcp-servers.md, Live check). Unchecked is plain
// muted text, not a pill: there is no state to report yet.
export function McpConnectionBadge({
  live
}: {
  live: { status: McpLiveStatus; checkedAt: string } | null
}): React.JSX.Element {
  if (live === null)
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <CircleDashed aria-hidden="true" className="size-3 shrink-0" />
        Not checked
      </span>
    )
  const { Icon, iconClass, label, meaning } = CONNECTION[live.status]
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="inline-flex cursor-default items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-foreground select-none">
          <Icon aria-hidden="true" className={cn('size-3 shrink-0', iconClass)} />
          <span className="truncate">{label}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="top">
        {meaning} Checked {formatRelativeTime(live.checkedAt)}.
      </TooltipContent>
    </Tooltip>
  )
}
