import { cn } from '@/lib/utils'

// A project label is a name with parent folders added only for disambiguation (`Desktop/api`).
// Folder names can't contain `/` on macOS or Windows, so the last `/` always splits them. The
// prefix gives way first so the name stays readable in a narrow column.
export function ProjectName({
  label,
  className,
  prefixClassName = 'text-muted-foreground'
}: {
  label: string
  className?: string
  // Muted ink holds 4.5:1 on paper and cards but not on the lime selected fill, which passes its own.
  prefixClassName?: string
}): React.JSX.Element {
  const cut = label.lastIndexOf('/')
  if (cut < 0 || cut === label.length - 1)
    return <span className={cn('min-w-0 truncate', className)}>{label}</span>
  // The two halves are flex items, which Chrome's accessible-name computation separates with a
  // space ("Desktop/ api"), so assistive tech reads one unbroken copy instead.
  return (
    <span dir="ltr" className={cn('flex min-w-0', className)}>
      <span aria-hidden="true" className={cn('min-w-0 truncate', prefixClassName)}>
        {label.slice(0, cut + 1)}
      </span>
      <span aria-hidden="true" className="max-w-full shrink-0 truncate">
        {label.slice(cut + 1)}
      </span>
      <span className="sr-only">{label}</span>
    </span>
  )
}
