import { motion, useReducedMotion } from 'motion/react'
import { GLIDE_SPRING } from '@/lib/transitions'

// A shared glide runs on the destination's transition, so a list row stays a glide source while
// Back lands on it instantly. Gliding into the list would start clipped under its title strip (the
// row sits inside the table's scroll container) and slide across other rows' names.
const ARRIVE_INSTANTLY = { duration: 0 } as const

interface GlideTitleProps {
  as?: 'span' | 'h2'
  glideId: string
  level: 'list' | 'detail' | 'files'
  className?: string
  children: React.ReactNode
}

// A name that glides from a list row into the screens it opens (motion-dom 13.1 constraints):
// - Each level passes its own layoutDependency. Both ends sharing one value makes motion skip
//   the glide, and leaving it undefined re-measures on every render, so a sort or a scan banner
//   would make titles glide on their own.
// - The destination must mount in the same commit the source leaves: an unmounting node's
//   snapshot is dropped on the next update. That's why detail headers render from the list row
//   instead of waiting for their query.
// - layout="position" moves the top-left corner and keeps the final size, so 13px → 16px
//   snaps rather than stretching the text.
export function GlideTitle({
  as = 'span',
  glideId,
  level,
  className,
  children
}: GlideTitleProps): React.JSX.Element {
  const reduceMotion = useReducedMotion() === true
  const props = {
    'data-glide': true,
    className,
    layoutId: reduceMotion ? undefined : glideId,
    layout: reduceMotion ? false : ('position' as const),
    layoutDependency: level,
    transition: level === 'list' ? ARRIVE_INSTANTLY : GLIDE_SPRING
  }
  return as === 'h2' ? (
    <motion.h2 {...props}>{children}</motion.h2>
  ) : (
    <motion.span {...props}>{children}</motion.span>
  )
}
