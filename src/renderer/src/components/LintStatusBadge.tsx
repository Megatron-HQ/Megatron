import React from 'react'
import { CircleCheck, CircleX, TriangleAlert } from 'lucide-react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { LintStatus } from '../../../shared/ipc'
import { cn } from '@/lib/utils'

export interface LintStatusBadgeProps {
  status: LintStatus
  errorCount?: number
  warningCount?: number
  className?: string
  showLabel?: boolean
}

export function LintStatusBadge({
  status,
  errorCount = 0,
  warningCount = 0,
  className,
  showLabel = true
}: LintStatusBadgeProps): React.JSX.Element {
  let Icon = CircleCheck
  let iconClass = 'text-success'
  let label = 'Valid'
  let tooltip = 'All checks passed'

  if (status === 'error') {
    Icon = CircleX
    iconClass = 'text-destructive'
    label = errorCount > 0 ? `${errorCount} ${errorCount === 1 ? 'Error' : 'Errors'}` : 'Error'
    tooltip = `${errorCount} error${errorCount !== 1 ? 's' : ''}${
      warningCount > 0 ? `, ${warningCount} warning${warningCount !== 1 ? 's' : ''}` : ''
    }`
  } else if (status === 'warning') {
    Icon = TriangleAlert
    iconClass = 'text-warning'
    label =
      warningCount > 0
        ? `${warningCount} ${warningCount === 1 ? 'Warning' : 'Warnings'}`
        : 'Warning'
    tooltip = `${warningCount} warning${warningCount !== 1 ? 's' : ''}`
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium border border-border bg-muted/40 text-foreground select-none cursor-default',
            className
          )}
        >
          <Icon className={cn('size-3 shrink-0', iconClass)} />
          {showLabel && <span className="truncate">{label}</span>}
        </div>
      </TooltipTrigger>
      <TooltipContent side="top">
        <p className="text-xs">{tooltip}</p>
      </TooltipContent>
    </Tooltip>
  )
}
