import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { formatExactTokenCount, formatTokenCount } from '../../../../shared/token-format'

export function TokenValue({
  value,
  className,
  hint
}: {
  value: number
  className?: string
  hint?: string
}): React.JSX.Element {
  const exact = formatExactTokenCount(value)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          aria-label={`${exact} tokens`}
          className={cn(
            'rounded-[2px] outline-none focus-visible:ring-1 focus-visible:ring-ring',
            className
          )}
        >
          {formatTokenCount(value)}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <p>{exact} exact tokens</p>
        {hint && <p className="mt-1 text-[11px] opacity-75">{hint}</p>}
      </TooltipContent>
    </Tooltip>
  )
}
