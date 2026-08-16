import { Badge } from '@/components/ui/badge'
import { SOURCE_ICON } from '@/lib/source-icon'
import { getSourceDisplayName, getSourceTooltip } from '@/lib/source-name'
import { cn } from '@/lib/utils'
import type { SourceType } from '../../../shared/ipc'

export interface SourceBadgeProps {
  type: SourceType
  sourcePath?: string
  pluginName?: string | null
  label?: string
  className?: string
}

export function SourceBadge({
  type,
  sourcePath,
  pluginName,
  label,
  className
}: SourceBadgeProps): React.JSX.Element {
  const Icon = SOURCE_ICON[type]
  const displayName = label ?? getSourceDisplayName(type, sourcePath, pluginName)
  const tooltip = getSourceTooltip(type, sourcePath, pluginName)

  return (
    <Badge
      variant="outline"
      className={cn('inline-flex max-w-[180px] items-center gap-1 font-normal', className)}
      title={tooltip}
    >
      <Icon className="size-3 shrink-0" />
      <span className="truncate">{displayName}</span>
    </Badge>
  )
}
