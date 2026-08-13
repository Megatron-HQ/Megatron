import { ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'

export function CircleArrow({ className }: { className?: string }): React.JSX.Element {
  return (
    <span
      className={cn(
        'pointer-events-none inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-white text-navy shadow-[0_4px_14px_rgba(12,56,84,0.12)]',
        className
      )}
      aria-hidden="true"
    >
      <ArrowRight className="size-5" strokeWidth={2.4} />
    </span>
  )
}
