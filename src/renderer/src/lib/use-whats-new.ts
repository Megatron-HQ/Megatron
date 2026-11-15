import { useCallback, useEffect, useRef, useState } from 'react'
import type { WhatsNewAnchorId, WhatsNewRelease } from '../../../shared/whats-new'
import { anchorAt } from '@/lib/whats-new'

export interface WhatsNewState {
  releases: WhatsNewRelease[] // what the card shows now; empty hides it
  dots: ReadonlySet<WhatsNewAnchorId>
  spotlight: WhatsNewAnchorId | null
  // Hides the card and records it seen. `viewedAnchor` is the one "Show me" is about to ring,
  // so its dot is cleared after main has placed the dots, never raced against it.
  dismiss: (viewedAnchor?: WhatsNewAnchorId) => void
  replay: (() => void) | null // null when this build has no release to replay
  startSpotlight: (anchor: WhatsNewAnchorId) => void
  endSpotlight: () => void
}

const ACTIVATION_KEYS = new Set(['Enter', ' '])

export function useWhatsNew(): WhatsNewState {
  const [initial] = useState(() => window.api.getInitialWhatsNew())
  const [releases, setReleases] = useState(initial.unseen)
  const [dots, setDots] = useState<ReadonlySet<WhatsNewAnchorId>>(() => new Set(initial.dots))
  const [spotlight, setSpotlight] = useState<WhatsNewAnchorId | null>(null)
  const dotsRef = useRef(dots)
  useEffect(() => {
    dotsRef.current = dots
  }, [dots])

  const clearDot = useCallback((anchor: WhatsNewAnchorId): void => {
    if (!dotsRef.current.has(anchor)) return
    setDots((current) => new Set([...current].filter((existing) => existing !== anchor)))
    void window.api.clearWhatsNewDot(anchor)
  }, [])

  // One listener for every anchor, so marking a control new never touches its own handlers.
  useEffect(() => {
    const clearAt = (target: EventTarget | null): void => {
      const anchor = anchorAt(target)
      if (anchor) clearDot(anchor)
    }
    const onPointerDown = (event: PointerEvent): void => clearAt(event.target)
    const onKeyDown = (event: KeyboardEvent): void => {
      if (ACTIVATION_KEYS.has(event.key)) clearAt(event.target)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [clearDot])

  const dismiss = useCallback((viewedAnchor?: WhatsNewAnchorId): void => {
    setReleases([])
    void window.api.markWhatsNewSeen().then((placed) => {
      if (viewedAnchor) void window.api.clearWhatsNewDot(viewedAnchor)
      setDots(new Set(placed.filter((anchor) => anchor !== viewedAnchor)))
    })
  }, [])

  const latest = initial.latest
  const replay = useCallback(() => {
    if (latest) setReleases([latest])
  }, [latest])

  return {
    releases,
    dots,
    spotlight,
    dismiss,
    replay: latest ? replay : null,
    startSpotlight: setSpotlight,
    endSpotlight: useCallback(() => setSpotlight(null), [])
  }
}
