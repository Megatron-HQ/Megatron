import { Lock } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { SOURCE_ICON, SYNCED_ICON } from '@/lib/source-icon'
import { getSourceDisplayName, getSourceTooltip } from '@/lib/source-name'
import { cn } from '@/lib/utils'
import type { SourceType } from '../../../shared/ipc'

export interface SourceBadgeProps {
  type: SourceType
  sourcePath?: string
  pluginName?: string | null
  isSynced?: boolean
  label?: string
  className?: string
}

export function SourceBadge({
  type,
  sourcePath,
  pluginName,
  isSynced,
  label,
  className
}: SourceBadgeProps): React.JSX.Element {
  const Icon = isSynced ? SYNCED_ICON : SOURCE_ICON[type]
  const displayName = label ?? getSourceDisplayName(type, sourcePath, pluginName, isSynced)
  const tooltip = getSourceTooltip(type, sourcePath, pluginName, isSynced)

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className={cn('inline-flex max-w-full items-center gap-1 font-normal', className)}
        >
          <Icon className="size-3 shrink-0" />
          <span className="truncate">{displayName}</span>
          {type === 'plugin' && <Lock className="size-3 shrink-0" />}
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="top">{tooltip}</TooltipContent>
    </Tooltip>
  )
}
