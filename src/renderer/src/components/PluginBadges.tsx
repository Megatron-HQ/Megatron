import { CircleCheck, Power, ShieldCheck, Store } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

// Hardcoded recognition of Anthropic's own marketplace — every other marketplace groups and
// badges under its own real name.
const OFFICIAL_MARKETPLACE = 'claude-plugins-official'

export function MarketplaceBadge({
  marketplace,
  className
}: {
  marketplace: string
  className?: string
}): React.JSX.Element {
  const isOfficial = marketplace === OFFICIAL_MARKETPLACE
  const Icon = isOfficial ? ShieldCheck : Store
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className={cn('inline-flex max-w-full items-center gap-1 font-normal', className)}
        >
          <Icon className="size-3 shrink-0" />
          <span className="truncate">{isOfficial ? 'Official' : marketplace}</span>
        </Badge>
      </TooltipTrigger>
      <TooltipContent side="top">
        {isOfficial ? `Official marketplace (${marketplace})` : `Marketplace: ${marketplace}`}
      </TooltipContent>
    </Tooltip>
  )
}

export function PluginStatusBadge({
  disabledReason
}: {
  disabledReason: string | null
}): React.JSX.Element {
  const disabled = disabledReason !== null
  const Icon = disabled ? Power : CircleCheck
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="inline-flex cursor-default items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2 py-0.5 text-[11px] font-medium text-foreground select-none">
          <Icon
            className={cn('size-3 shrink-0', disabled ? 'text-disabled-flag' : 'text-success')}
          />
          <span className="truncate">{disabled ? 'Disabled' : 'Enabled'}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="top">
        {disabled ? 'Not loaded into context.' : 'Loaded into context.'}
      </TooltipContent>
    </Tooltip>
  )
}
