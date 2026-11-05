import { Input } from '@/components/ui/input'

export const VISIBLE_PROJECT_COUNT = 8

export function ProjectSearch({
  value,
  onChange,
  visible,
  total,
  label = 'Search projects'
}: {
  value: string
  onChange: (value: string) => void
  visible: number
  total: number
  label?: string
}): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Input
        type="search"
        aria-label={label}
        placeholder="Search projects…"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-7 w-full max-w-60 text-[12px]"
      />
      <span className="text-[11px] tabular-nums text-muted-foreground" role="status">
        {visible} of {total} projects{value.trim() ? ' match' : ''}
      </span>
    </div>
  )
}
