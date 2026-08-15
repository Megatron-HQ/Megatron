import { Badge } from '@/components/ui/badge'
import { SOURCE_ICON } from '@/lib/source-icon'
import type { SourceType } from '../../../shared/ipc'

interface SourceBadgeProps {
  type: SourceType
}

export function SourceBadge({ type }: SourceBadgeProps): React.JSX.Element {
  const Icon = SOURCE_ICON[type]
  return (
    <Badge variant="outline" className="gap-1 font-normal capitalize">
      <Icon className="size-3" />
      {type}
    </Badge>
  )
}
