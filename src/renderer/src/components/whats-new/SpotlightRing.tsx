import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { useReducedMotion } from 'motion/react'
import type { WhatsNewAnchorId } from '../../../../shared/whats-new'
import { findAnchorElement } from '@/lib/whats-new'

// The section may still be mounting or waiting on its scan when "Show me" lands on it.
const ANCHOR_WAIT_MS = 2_000
// Matches the whats-new-ring animations in main.css.
const RING_DURATION_MS = 1_600
const RING_OUTSET_PX = 4

interface RingBox {
  top: number
  left: number
  width: number
  height: number
}

function ringBox(element: HTMLElement): RingBox {
  const rect = element.getBoundingClientRect()
  return {
    top: rect.top - RING_OUTSET_PX,
    left: rect.left - RING_OUTSET_PX,
    width: rect.width + RING_OUTSET_PX * 2,
    height: rect.height + RING_OUTSET_PX * 2
  }
}

function waitForAnchor(
  anchor: WhatsNewAnchorId,
  onFound: (element: HTMLElement) => void,
  onMissing: () => void
): () => void {
  const existing = findAnchorElement(anchor)
  if (existing) {
    onFound(existing)
    return () => {}
  }
  const observer = new MutationObserver(() => {
    const element = findAnchorElement(anchor)
    if (!element) return
    stop()
    onFound(element)
  })
  const timeout = window.setTimeout(() => {
    stop()
    onMissing()
  }, ANCHOR_WAIT_MS)
  function stop(): void {
    observer.disconnect()
    window.clearTimeout(timeout)
  }
  observer.observe(document.body, { childList: true, subtree: true })
  return stop
}

// An overlay drawn over the anchor, never a class on it, so the anchor's own hover, glide and
// focus styles are untouched. It follows the anchor while the page scrolls or settles.
export function SpotlightRing({
  anchor,
  onDone
}: {
  anchor: WhatsNewAnchorId
  onDone: () => void
}): React.JSX.Element | null {
  const reduceMotion = useReducedMotion() === true
  const [box, setBox] = useState<RingBox | null>(null)

  useEffect(() => {
    let frame = 0
    let finish = 0
    const stopWaiting = waitForAnchor(
      anchor,
      (element) => {
        element.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' })
        const track = (): void => {
          setBox(ringBox(element))
          frame = requestAnimationFrame(track)
        }
        track()
        finish = window.setTimeout(onDone, RING_DURATION_MS)
      },
      () => {
        // Expected for users whose data never renders this control (no plugins, empty Usage);
        // the section switch already happened, so there is nothing to show them.
        if (import.meta.env.DEV) console.warn(`[whats-new] anchor "${anchor}" never appeared`)
        onDone()
      }
    )
    return () => {
      stopWaiting()
      cancelAnimationFrame(frame)
      window.clearTimeout(finish)
    }
  }, [anchor, onDone, reduceMotion])

  if (box === null) return null
  return createPortal(
    <div
      aria-hidden
      data-whats-new-ring={anchor}
      className="whats-new-ring pointer-events-none fixed z-[60] rounded-lg border-2 border-ring"
      style={box}
    />,
    document.body
  )
}
