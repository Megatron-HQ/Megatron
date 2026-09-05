import { cn } from '@/lib/utils'

// Underline sweep adapted from Skiper UI's Skiper40 "Link001"
// (https://skiper-ui.com/v1/skiper40, author @gurvinder-singh02, inspired by cursor.com) —
// its free-tier license requires attribution. The `before:` pseudo-element geometry, the
// origin-flip on hover, and the 300ms cubic-bezier are lifted verbatim. Two deliberate
// departures: thickness is 1px rather than the original 0.05em (sub-pixel at Megatron's
// 11-13px type), and the reveal also fires on `:focus-visible` so keyboard users get the
// same affordance. skiper40 ships this as a `next/link` anchor with an external-URL arrow;
// every call site here is in-app navigation, so it's a `<button>` with no arrow.
export function TextLink({
  className,
  ...props
}: React.ComponentProps<'button'>): React.JSX.Element {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        'relative inline-flex max-w-full items-center focus-visible:outline-none',
        "before:pointer-events-none before:absolute before:top-[1.5em] before:left-0 before:h-px before:w-full before:bg-current before:content-['']",
        'before:origin-right before:scale-x-0 before:transition-transform before:duration-300 before:ease-[cubic-bezier(0.4,0,0.2,1)]',
        'hover:before:origin-left hover:before:scale-x-100',
        'focus-visible:before:origin-left focus-visible:before:scale-x-100',
        'motion-reduce:before:transition-none',
        className
      )}
    />
  )
}
