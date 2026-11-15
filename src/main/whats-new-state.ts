import { compareSemver, isSemanticVersion } from '../shared/version'
import {
  WHATS_NEW_ANCHOR_IDS,
  anchorsOf,
  latestReleaseUpTo,
  selectUnseenReleases,
  type WhatsNewAnchorId,
  type WhatsNewInitialState,
  type WhatsNewRelease
} from '../shared/whats-new'
import { listAllowedPaths } from './folder-grants'
import type { ThemeStore } from './theme'

const DOT_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000

function storedSeenVersion(store: ThemeStore): string | null {
  const stored: unknown = store.get('whatsNewSeenVersion')
  return typeof stored === 'string' && isSemanticVersion(stored) ? stored : null
}

// Without a record, someone who finished onboarding or granted folders ran an older build, so the
// running version's entry is news (null); anyone else is a fresh install, for whom nothing is.
export function resolveWhatsNewSeenVersion(
  store: ThemeStore,
  currentVersion: string
): string | null {
  const stored = storedSeenVersion(store)
  if (stored !== null) return stored
  const isUpgrader = store.get('onboardingDone') === true || listAllowedPaths(store).length > 0
  return isUpgrader ? null : currentVersion
}

// Called when onboarding finishes. A replay from Settings keeps the existing record, or it would
// mark a release seen that the user never saw.
export function recordWhatsNewBaseline(store: ThemeStore, currentVersion: string): void {
  if (storedSeenVersion(store) === null) store.set('whatsNewSeenVersion', currentVersion)
}

export interface MarkWhatsNewSeenOptions {
  releases: WhatsNewRelease[]
  currentVersion: string
  now: Date
}

export function markWhatsNewSeen(
  store: ThemeStore,
  { releases, currentVersion, now }: MarkWhatsNewSeenOptions
): void {
  const shown = selectUnseenReleases(
    releases,
    currentVersion,
    resolveWhatsNewSeenVersion(store, currentVersion)
  )
  // A replay shows nothing new and must keep the dots the first showing left.
  if (shown.length > 0)
    store.set('whatsNewDots', {
      anchors: anchorsOf(shown),
      expiresAt: new Date(now.getTime() + DOT_LIFETIME_MS).toISOString()
    })
  const stored = storedSeenVersion(store)
  const isDowngrade = stored !== null && (compareSemver(stored, currentVersion) ?? 0) > 0
  if (!isDowngrade && isSemanticVersion(currentVersion))
    store.set('whatsNewSeenVersion', currentVersion)
}

export function resolveWhatsNewInitialState(
  store: ThemeStore,
  { releases, currentVersion, now }: MarkWhatsNewSeenOptions
): WhatsNewInitialState {
  return {
    unseen: selectUnseenReleases(
      releases,
      currentVersion,
      resolveWhatsNewSeenVersion(store, currentVersion)
    ),
    latest: latestReleaseUpTo(releases, currentVersion),
    dots: activeWhatsNewDots(store, now)
  }
}

function storedDots(store: ThemeStore): { anchors: string[]; expiresAt: number } | null {
  const stored: unknown = store.get('whatsNewDots')
  if (typeof stored !== 'object' || stored === null) return null
  const { anchors, expiresAt } = stored as Record<string, unknown>
  const expiry = typeof expiresAt === 'string' ? Date.parse(expiresAt) : NaN
  if (!Array.isArray(anchors) || !Number.isFinite(expiry)) return null
  return { anchors: anchors.filter((anchor) => typeof anchor === 'string'), expiresAt: expiry }
}

export function activeWhatsNewDots(store: ThemeStore, now: Date): WhatsNewAnchorId[] {
  const dots = storedDots(store)
  if (dots === null || now.getTime() >= dots.expiresAt) return []
  // A later build may retire an anchor id; its dot has nothing left to sit on.
  return WHATS_NEW_ANCHOR_IDS.filter((anchor) => dots.anchors.includes(anchor))
}

export function clearWhatsNewDot(store: ThemeStore, anchor: WhatsNewAnchorId): void {
  const stored = store.get('whatsNewDots')
  if (!storedDots(store) || !stored) return
  store.set('whatsNewDots', {
    ...stored,
    anchors: stored.anchors.filter((existing) => existing !== anchor)
  })
}
