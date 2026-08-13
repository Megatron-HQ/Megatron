import { ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface BentoGridProps {
  children: ReactNode
  className?: string
}

export function BentoGrid({ children, className }: BentoGridProps): React.JSX.Element {
  return <div className={cn('bento-grid', className)}>{children}</div>
}
