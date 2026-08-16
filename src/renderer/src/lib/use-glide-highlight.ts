import { useCallback, useState } from 'react'
import { useReducedMotion } from 'motion/react'

export function useGlideHighlight<TId>(): {
  hoveredId: TId | null
  setHoveredId: (id: TId | null) => void
  onMouseLeave: () => void
  reduceMotion: boolean
  transition: { duration: 0 } | { type: 'spring'; stiffness: number; damping: number }
} {
  const reduceMotion = useReducedMotion() === true
  const [hoveredId, setHoveredId] = useState<TId | null>(null)
  const onMouseLeave = useCallback(() => setHoveredId(null), [])
  const transition = reduceMotion
    ? ({ duration: 0 } as const)
    : { type: 'spring' as const, stiffness: 500, damping: 40 }

  return { hoveredId, setHoveredId, onMouseLeave, reduceMotion, transition }
}
