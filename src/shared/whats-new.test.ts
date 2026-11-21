import { describe, expect, it } from 'vitest'
import catalogJson from './whats-new.json'
import {
  anchorsOf,
  latestReleaseUpTo,
  parseWhatsNewCatalog,
  selectUnseenReleases,
  type WhatsNewRelease
} from './whats-new'

const highlight = { title: 'Cost per skill', body: 'See which skills drive your spend.' }

const release = (version: string, anchors: string[] = []): WhatsNewRelease => ({
  version,
  title: `Megatron ${version}`,
  highlights: [
    highlight,
    ...anchors.map((anchor) => ({
      title: 'Anchored',
      body: 'Has an anchor.',
      action: { kind: 'section' as const, section: 'usage' as const, anchor: anchor as never }
    }))
  ]
})

describe('parseWhatsNewCatalog', () => {
  it('accepts the shipped catalog', () => {
    expect(() => parseWhatsNewCatalog(catalogJson)).not.toThrow()
  })

  it('orders releases newest first by semver, not by key order or string order', () => {
    const catalog = parseWhatsNewCatalog({
      '0.9.0': { title: 'Nine', highlights: [highlight] },
      '0.10.0': { title: 'Ten', highlights: [highlight] },
      '0.3.0': { title: 'Three', highlights: [highlight] }
    })
    expect(catalog.releases.map((entry) => entry.version)).toEqual(['0.10.0', '0.9.0', '0.3.0'])
  })

  it('keeps the next draft out of the releases', () => {
    const catalog = parseWhatsNewCatalog({
      next: { title: 'Draft', highlights: [highlight] },
      '0.3.0': { title: 'Three', highlights: [highlight] }
    })
    expect(catalog.releases.map((entry) => entry.version)).toEqual(['0.3.0'])
    expect(catalog.draft?.title).toBe('Draft')
  })

  it('reports no draft when there is none', () => {
    expect(parseWhatsNewCatalog({}).draft).toBeNull()
  })

  it('keeps a valid action, preview and anchor', () => {
    const catalog = parseWhatsNewCatalog({
      '0.3.0': {
        title: 'Three',
        highlights: [
          {
            ...highlight,
            preview: 'usage-skill-cost',
            action: { kind: 'section', section: 'usage', anchor: 'usage-skill-cost' }
          },
          { ...highlight, action: { kind: 'settings' } },
          { ...highlight, action: { kind: 'settings', pane: 'claude-code' } },
          { ...highlight, action: { kind: 'palette' } }
        ]
      }
    })
    expect(catalog.releases[0].highlights).toEqual([
      {
        ...highlight,
        preview: 'usage-skill-cost',
        action: { kind: 'section', section: 'usage', anchor: 'usage-skill-cost' }
      },
      { ...highlight, action: { kind: 'settings' } },
      { ...highlight, action: { kind: 'settings', pane: 'claude-code' } },
      { ...highlight, action: { kind: 'palette' } }
    ])
  })

  it.each([
    ['a non-object catalog', []],
    ['a key that is neither semver nor next', { latest: { title: 'x', highlights: [highlight] } }],
    ['a missing title', { '0.3.0': { highlights: [highlight] } }],
    ['an empty title', { '0.3.0': { title: ' ', highlights: [highlight] } }],
    ['no highlights', { '0.3.0': { title: 'x', highlights: [] } }],
    [
      'more than four highlights',
      { '0.3.0': { title: 'x', highlights: Array(5).fill(highlight) } }
    ],
    ['an unknown release field', { '0.3.0': { title: 'x', highlights: [highlight], hero: 'a' } }],
    [
      'an empty highlight body',
      { '0.3.0': { title: 'x', highlights: [{ title: 'x', body: '' }] } }
    ],
    [
      'a highlight body over 160 characters',
      { '0.3.0': { title: 'x', highlights: [{ title: 'x', body: 'b'.repeat(161) }] } }
    ],
    [
      'a highlight title over 60 characters',
      { '0.3.0': { title: 'x', highlights: [{ title: 't'.repeat(61), body: 'b' }] } }
    ],
    [
      'an unknown highlight field',
      { '0.3.0': { title: 'x', highlights: [{ ...highlight, icon: 'star' }] } }
    ],
    [
      'an unknown preview id',
      { '0.3.0': { title: 'x', highlights: [{ ...highlight, preview: 'hero-shot' }] } }
    ],
    [
      'an unknown section',
      {
        '0.3.0': {
          title: 'x',
          highlights: [{ ...highlight, action: { kind: 'section', section: 'settings' } }]
        }
      }
    ],
    [
      'an unknown settings pane',
      {
        '0.3.0': {
          title: 'x',
          highlights: [{ ...highlight, action: { kind: 'settings', pane: 'data' } }]
        }
      }
    ],
    [
      'an unknown anchor',
      {
        '0.3.0': {
          title: 'x',
          highlights: [
            { ...highlight, action: { kind: 'section', section: 'usage', anchor: 'nope' } }
          ]
        }
      }
    ],
    [
      'an unknown action kind',
      { '0.3.0': { title: 'x', highlights: [{ ...highlight, action: { kind: 'url' } }] } }
    ],
    [
      'an anchor on the palette action',
      {
        '0.3.0': {
          title: 'x',
          highlights: [{ ...highlight, action: { kind: 'palette', anchor: 'usage-skill-cost' } }]
        }
      }
    ]
  ])('rejects %s', (_label, raw) => {
    expect(() => parseWhatsNewCatalog(raw)).toThrow()
  })

  it('names the offending entry in the error', () => {
    expect(() =>
      parseWhatsNewCatalog({ '0.3.0': { title: 'x', highlights: [{ title: 'x', body: '' }] } })
    ).toThrow(/0\.3\.0/)
  })
})

describe('selectUnseenReleases', () => {
  const releases = [release('0.5.0'), release('0.4.0'), release('0.3.0')]
  const versions = (selected: WhatsNewRelease[]): string[] => selected.map((entry) => entry.version)

  it('shows every release newer than the seen version up to the running one, newest first', () => {
    expect(versions(selectUnseenReleases(releases, '0.5.0', '0.2.2'))).toEqual([
      '0.5.0',
      '0.4.0',
      '0.3.0'
    ])
  })

  it('never shows a release newer than the running version', () => {
    expect(versions(selectUnseenReleases(releases, '0.4.1', '0.2.2'))).toEqual(['0.4.0', '0.3.0'])
  })

  it('shows nothing once the running version has been seen', () => {
    expect(selectUnseenReleases(releases, '0.5.0', '0.5.0')).toEqual([])
  })

  it('shows nothing after a downgrade below the seen version', () => {
    expect(selectUnseenReleases(releases, '0.4.0', '0.5.0')).toEqual([])
  })

  it('shows only the running version for an upgrader with no record', () => {
    expect(versions(selectUnseenReleases(releases, '0.4.0', null))).toEqual(['0.4.0'])
  })

  it('shows nothing for an upgrader with no record when the running version has no entry', () => {
    expect(selectUnseenReleases(releases, '0.4.1', null)).toEqual([])
  })

  it('shows nothing when the running version is not semver', () => {
    expect(selectUnseenReleases(releases, 'unknown', '0.2.2')).toEqual([])
  })

  it('treats an unparseable seen version like no record', () => {
    expect(versions(selectUnseenReleases(releases, '0.5.0', 'garbage'))).toEqual(['0.5.0'])
  })
})

describe('latestReleaseUpTo', () => {
  const releases = [release('0.5.0'), release('0.3.0')]

  it('returns the newest release at or below the running version', () => {
    expect(latestReleaseUpTo(releases, '0.4.2')?.version).toBe('0.3.0')
    expect(latestReleaseUpTo(releases, '0.5.0')?.version).toBe('0.5.0')
  })

  it('returns null when every release is newer than the running version', () => {
    expect(latestReleaseUpTo(releases, '0.2.0')).toBeNull()
  })
})

describe('anchorsOf', () => {
  it('collects each anchor once across releases, skipping highlights without one', () => {
    expect(
      anchorsOf([release('0.5.0', ['usage-skill-cost']), release('0.4.0', ['usage-skill-cost'])])
    ).toEqual(['usage-skill-cost'])
    expect(anchorsOf([release('0.5.0')])).toEqual([])
  })
})
