import { useState } from 'react'
import type { TargetAndTransition } from 'motion/react'

// The one source for DESIGN.md's Transitions entry: every screen enter, data settle, and title
// glide reads its timing from here, so the pieces can't drift apart.

export const ENTER = { duration: 0.15, ease: 'easeOut' } as const

// Shared with the hover glide highlight: the title glide and the row glides are the same motion.
export const GLIDE_SPRING = { type: 'spring', stiffness: 500, damping: 40 } as const

export type ScreenEnterKind = 'section' | 'deeper' | 'back'

export function screenEnter(kind: ScreenEnterKind, reduceMotion: boolean): TargetAndTransition {
  if (reduceMotion) return { opacity: 0 }
  if (kind === 'section') return { opacity: 0, y: 4 }
  return { opacity: 0, x: kind === 'deeper' ? 16 : -16 }
}

// Pending is captured at mount, so only a view that opened before its data arrived settles; a
// refetch or poll never does, and cached data shows at once. Opacity only, so reduced motion
// keeps it and there's no useReducedMotion() guard.
export function useSettle(pending: boolean):
  | { 'data-settle': true; initial: false }
  | {
      'data-settle': true
      initial: { opacity: number }
      animate: { opacity: number }
      transition: typeof ENTER
    } {
  const [mountedPending] = useState(pending)
  return mountedPending
    ? { 'data-settle': true, initial: { opacity: 0 }, animate: { opacity: 1 }, transition: ENTER }
    : { 'data-settle': true, initial: false }
}

export function skillTitleGlideId(skillId: number): string {
  return `skill-title:${skillId}`
}

export function pluginTitleGlideId(rowKey: string): string {
  return `plugin-title:${rowKey}`
}
