import { createContext, useContext } from 'react'
import { WHATS_NEW_ANCHOR_IDS, type WhatsNewAnchorId } from '../../../shared/whats-new'
import type { UsagePanel } from '@/components/UsageSidebar'

export const WHATS_NEW_ANCHOR_ATTRIBUTE = 'data-whats-new'

// Where an anchor lives below its section, for anchors a section switch alone doesn't reveal.
export const WHATS_NEW_ANCHOR_PANELS: Record<WhatsNewAnchorId, UsagePanel | null> = {
  'usage-skill-cost': 'skills',
  'usage-mcp': 'mcp'
}

export function anchorProps(anchor: WhatsNewAnchorId): Record<string, string> {
  return { [WHATS_NEW_ANCHOR_ATTRIBUTE]: anchor }
}

export function findAnchorElement(anchor: WhatsNewAnchorId): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[${WHATS_NEW_ANCHOR_ATTRIBUTE}="${anchor}"]`)
}

// The anchor of the control an interaction landed in, if it is one this build knows.
export function anchorAt(target: EventTarget | null): WhatsNewAnchorId | null {
  if (!(target instanceof Element)) return null
  const value = target
    .closest(`[${WHATS_NEW_ANCHOR_ATTRIBUTE}]`)
    ?.getAttribute(WHATS_NEW_ANCHOR_ATTRIBUTE)
  return (WHATS_NEW_ANCHOR_IDS as readonly (string | null | undefined)[]).includes(value)
    ? (value as WhatsNewAnchorId)
    : null
}

export const WhatsNewDotsContext = createContext<ReadonlySet<WhatsNewAnchorId>>(new Set())

export function useWhatsNewDot(anchor: WhatsNewAnchorId): boolean {
  return useContext(WhatsNewDotsContext).has(anchor)
}
