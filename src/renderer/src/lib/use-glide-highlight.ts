import { useCallback, useRef, useState } from 'react'
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

export interface ElementHighlightRect {
  top: number
  left: number
  width: number
  height: number
}

export function useElementGlideHighlight<TContainer extends HTMLElement = HTMLElement>(): {
  containerRef: React.RefObject<TContainer | null>
  highlightRect: ElementHighlightRect | null
  onItemHover: (el: HTMLElement | null) => void
  onMouseLeave: () => void
  reduceMotion: boolean
  transition: { duration: 0 } | { type: 'spring'; stiffness: number; damping: number }
} {
  const reduceMotion = useReducedMotion() === true
  const containerRef = useRef<TContainer | null>(null)
  const [highlightRect, setHighlightRect] = useState<ElementHighlightRect | null>(null)

  const onItemHover = useCallback((el: HTMLElement | null): void => {
    if (!el || !containerRef.current) {
      setHighlightRect(null)
      return
    }
    const containerRect = containerRef.current.getBoundingClientRect()
    const elRect = el.getBoundingClientRect()
    setHighlightRect({
      top: elRect.top - containerRect.top + containerRef.current.scrollTop,
      left: elRect.left - containerRect.left + containerRef.current.scrollLeft,
      width: elRect.width,
      height: elRect.height
    })
  }, [])

  const onMouseLeave = useCallback((): void => {
    setHighlightRect(null)
  }, [])

  const transition = reduceMotion
    ? ({ duration: 0 } as const)
    : { type: 'spring' as const, stiffness: 500, damping: 40 }

  return { containerRef, highlightRect, onItemHover, onMouseLeave, reduceMotion, transition }
}
