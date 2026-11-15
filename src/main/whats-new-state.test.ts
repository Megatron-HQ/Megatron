import Store from 'electron-store'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { WhatsNewRelease } from '../shared/whats-new'
import type { ThemeStore } from './theme'
import {
  activeWhatsNewDots,
  clearWhatsNewDot,
  markWhatsNewSeen,
  recordWhatsNewBaseline,
  resolveWhatsNewInitialState,
  resolveWhatsNewSeenVersion
} from './whats-new-state'

let tempDir: string
let store: ThemeStore

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'megatron-whats-new-test-'))
  store = new Store({ name: 'preferences', cwd: tempDir })
})

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

const NOW = new Date('2026-11-14T12:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1000

const release = (version: string, anchored: boolean): WhatsNewRelease => ({
  version,
  title: version,
  highlights: [
    anchored
      ? {
          title: 'Cost per skill',
          body: 'Body',
          action: { kind: 'section', section: 'usage', anchor: 'usage-skill-cost' }
        }
      : { title: 'Plain', body: 'Body' }
  ]
})

const grantFolder = (): void =>
  store.set('grantedFolders', [{ path: resolve('/Users/me/code'), granted_at: '2026-11-01' }])
const resolve = (path: string): string => join(tempDir, path)

describe('resolveWhatsNewSeenVersion', () => {
  it('treats a fresh install as having seen the running version', () => {
    expect(resolveWhatsNewSeenVersion(store, '0.3.0')).toBe('0.3.0')
  })

  it('reports no record for an upgrader who finished onboarding before this feature', () => {
    store.set('onboardingDone', true)
    expect(resolveWhatsNewSeenVersion(store, '0.3.0')).toBeNull()
  })

  it('reports no record for an upgrader from before onboarding, who only has grants', () => {
    grantFolder()
    expect(resolveWhatsNewSeenVersion(store, '0.3.0')).toBeNull()
  })

  it('returns the recorded version once there is one', () => {
    store.set('onboardingDone', true)
    store.set('whatsNewSeenVersion', '0.2.2')
    expect(resolveWhatsNewSeenVersion(store, '0.3.0')).toBe('0.2.2')
  })

  it('ignores a corrupt record and falls back to the upgrader rule', () => {
    store.set('onboardingDone', true)
    store.set('whatsNewSeenVersion', 42 as never)
    expect(resolveWhatsNewSeenVersion(store, '0.3.0')).toBeNull()
  })
})

describe('recordWhatsNewBaseline', () => {
  it('marks the running version seen when onboarding finishes on a fresh install', () => {
    recordWhatsNewBaseline(store, '0.3.0')
    store.set('onboardingDone', true)
    expect(resolveWhatsNewSeenVersion(store, '0.3.0')).toBe('0.3.0')
  })

  it('keeps an existing record, so replaying onboarding does not swallow unseen news', () => {
    store.set('whatsNewSeenVersion', '0.2.2')
    recordWhatsNewBaseline(store, '0.3.0')
    expect(resolveWhatsNewSeenVersion(store, '0.3.0')).toBe('0.2.2')
  })
})

describe('markWhatsNewSeen', () => {
  it('records the running version as seen', () => {
    store.set('whatsNewSeenVersion', '0.2.2')
    markWhatsNewSeen(store, { releases: [], currentVersion: '0.3.0', now: NOW })
    expect(resolveWhatsNewSeenVersion(store, '0.3.0')).toBe('0.3.0')
  })

  it('never moves the record backwards after a downgrade', () => {
    store.set('whatsNewSeenVersion', '0.5.0')
    markWhatsNewSeen(store, { releases: [], currentVersion: '0.3.0', now: NOW })
    expect(resolveWhatsNewSeenVersion(store, '0.3.0')).toBe('0.5.0')
  })

  it('leaves dots on the anchors of the releases the card just showed', () => {
    store.set('whatsNewSeenVersion', '0.2.2')
    markWhatsNewSeen(store, {
      releases: [release('0.3.0', true)],
      currentVersion: '0.3.0',
      now: NOW
    })
    expect(activeWhatsNewDots(store, NOW)).toEqual(['usage-skill-cost'])
  })

  it('keeps the dots when the card is replayed with nothing new', () => {
    store.set('whatsNewSeenVersion', '0.2.2')
    const options = { releases: [release('0.3.0', true)], currentVersion: '0.3.0', now: NOW }
    markWhatsNewSeen(store, options)
    markWhatsNewSeen(store, options)
    expect(activeWhatsNewDots(store, NOW)).toEqual(['usage-skill-cost'])
  })

  it('replaces older dots when a newer release is shown', () => {
    store.set('whatsNewSeenVersion', '0.2.2')
    markWhatsNewSeen(store, {
      releases: [release('0.3.0', true)],
      currentVersion: '0.3.0',
      now: NOW
    })
    markWhatsNewSeen(store, {
      releases: [release('0.4.0', false), release('0.3.0', true)],
      currentVersion: '0.4.0',
      now: NOW
    })
    expect(activeWhatsNewDots(store, NOW)).toEqual([])
  })

  it('gives a fresh install no dots', () => {
    markWhatsNewSeen(store, {
      releases: [release('0.3.0', true)],
      currentVersion: '0.3.0',
      now: NOW
    })
    expect(activeWhatsNewDots(store, NOW)).toEqual([])
  })
})

describe('activeWhatsNewDots', () => {
  beforeEach(() => {
    store.set('whatsNewSeenVersion', '0.2.2')
    markWhatsNewSeen(store, {
      releases: [release('0.3.0', true)],
      currentVersion: '0.3.0',
      now: NOW
    })
  })

  it('keeps dots for just under 30 days', () => {
    expect(activeWhatsNewDots(store, new Date(NOW.getTime() + 30 * DAY_MS - 1))).toEqual([
      'usage-skill-cost'
    ])
  })

  it('drops dots after 30 days', () => {
    expect(activeWhatsNewDots(store, new Date(NOW.getTime() + 30 * DAY_MS))).toEqual([])
  })

  it('drops anchors a later build no longer knows', () => {
    store.set('whatsNewDots', {
      anchors: ['usage-skill-cost', 'retired-anchor'],
      expiresAt: new Date(NOW.getTime() + DAY_MS).toISOString()
    })
    expect(activeWhatsNewDots(store, NOW)).toEqual(['usage-skill-cost'])
  })

  it('ignores a corrupt dots record', () => {
    store.set('whatsNewDots', { anchors: 'usage-skill-cost', expiresAt: 'soon' } as never)
    expect(activeWhatsNewDots(store, NOW)).toEqual([])
  })
})

describe('resolveWhatsNewInitialState', () => {
  const releases = [release('0.4.0', false), release('0.3.0', true)]
  const versions = (entries: WhatsNewRelease[]): string[] => entries.map((entry) => entry.version)

  it('sends an upgrader the unseen releases, the latest for replay, and no dots yet', () => {
    store.set('whatsNewSeenVersion', '0.2.2')
    const state = resolveWhatsNewInitialState(store, {
      releases,
      currentVersion: '0.4.0',
      now: NOW
    })
    expect(versions(state.unseen)).toEqual(['0.4.0', '0.3.0'])
    expect(state.latest?.version).toBe('0.4.0')
    expect(state.dots).toEqual([])
  })

  it('sends a fresh install nothing unseen but still the latest, for the Settings replay', () => {
    const state = resolveWhatsNewInitialState(store, {
      releases,
      currentVersion: '0.4.0',
      now: NOW
    })
    expect(state.unseen).toEqual([])
    expect(state.latest?.version).toBe('0.4.0')
  })

  it('sends the dots left by an earlier showing', () => {
    store.set('whatsNewSeenVersion', '0.2.2')
    markWhatsNewSeen(store, { releases, currentVersion: '0.3.0', now: NOW })
    const state = resolveWhatsNewInitialState(store, {
      releases,
      currentVersion: '0.3.0',
      now: NOW
    })
    expect(state.unseen).toEqual([])
    expect(state.dots).toEqual(['usage-skill-cost'])
  })
})

describe('clearWhatsNewDot', () => {
  it('clears one anchor for good', () => {
    store.set('whatsNewSeenVersion', '0.2.2')
    markWhatsNewSeen(store, {
      releases: [release('0.3.0', true)],
      currentVersion: '0.3.0',
      now: NOW
    })
    clearWhatsNewDot(store, 'usage-skill-cost')
    expect(activeWhatsNewDots(store, NOW)).toEqual([])
  })

  it('does nothing when there are no dots', () => {
    clearWhatsNewDot(store, 'usage-skill-cost')
    expect(activeWhatsNewDots(store, NOW)).toEqual([])
  })
})
