import type { ReactNode } from 'react'

// A section's chart block: the 11px uppercase label (DESIGN.md `label-column`) over its content,
// with a quiet centered fallback when the window has nothing to show.
export function ChartBlock({
  label,
  empty,
  emptyMessage,
  children
}: {
  label: string
  empty?: boolean
  emptyMessage?: string
  children: ReactNode
}): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[11px] font-medium uppercase tracking-[0.04em] text-muted-foreground">
        {label}
      </span>
      {empty ? (
        <div className="flex h-[72px] items-center justify-center text-[13px] text-muted-foreground">
          {emptyMessage}
        </div>
      ) : (
        children
      )}
    </div>
  )
}
