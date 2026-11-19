import { CircleCheck, Info, Power, TriangleAlert } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { McpServerRow } from '../../../shared/ipc'

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`
}

// Lint state until the live connection check (T7) adds whether a server connects. Notices stay
// muted ink: the info tone is reserved for updates (DESIGN.md, Status tones).
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
