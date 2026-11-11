import { useEffect, useRef, type ReactNode } from 'react'

// Focus moves to each step's heading as it mounts, so screen readers announce the new step and
// Tab starts from the top of it. Mount-only: the live counts re-render steps constantly, and
// re-focusing on every render would pull focus off whatever the user was on.
export function StepHeading({
  title,
  children
}: {
  title: ReactNode
  children?: ReactNode
}): React.JSX.Element {
  const ref = useRef<HTMLHeadingElement>(null)
  useEffect(() => ref.current?.focus({ preventScroll: true }), [])

  return (
    <div className="flex flex-col gap-2 pr-8">
      <h2
        ref={ref}
        tabIndex={-1}
        className="text-2xl leading-tight font-semibold tracking-tight outline-none"
      >
        {title}
      </h2>
      {children && <p className="text-sm text-muted-foreground">{children}</p>}
    </div>
  )
}
