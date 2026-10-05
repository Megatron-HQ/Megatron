import { describe, expect, it } from 'vitest'
import {
  buildModelIdentity,
  groupByFamily,
  olderVersionSummary,
  parseModelKey,
  seriesColor
} from './model-identity'

describe('parseModelKey', () => {
  it('splits family and numeric version', () => {
    expect(parseModelKey('claude-opus-5-5')).toEqual({
      family: 'opus',
      tail: '5-5',
      version: [5, 5]
    })
    expect(parseModelKey('claude-sonnet-5')).toEqual({ family: 'sonnet', tail: '5', version: [5] })
  })

  it('keeps the family but drops the version for a non-numeric tail', () => {
    expect(parseModelKey('claude-sonnet-5-5-preview')).toEqual({
      family: 'sonnet',
      tail: '5-5-preview',
      version: null
    })
  })

  it('returns null for keys outside the claude-<family>-<tail> shape', () => {
    expect(parseModelKey('unattributed')).toBeNull()
    expect(parseModelKey('claude-3-5-sonnet')).toBeNull()
    expect(parseModelKey('gpt-4')).toBeNull()
  })
})

describe('buildModelIdentity', () => {
  it('ranks versions newest first and floors the tint at step 2', () => {
    const identify = buildModelIdentity([
      'claude-sonnet-4',
      'claude-sonnet-4-5',
      'claude-sonnet-5',
      'claude-sonnet-5-5'
    ])
    expect(identify('claude-sonnet-5-5')).toEqual({
      family: 'sonnet',
      slot: 1,
      tintStep: 0,
      newerKey: null
    })
    expect(identify('claude-sonnet-5')).toMatchObject({
      tintStep: 1,
      newerKey: 'claude-sonnet-5-5'
    })
    expect(identify('claude-sonnet-4-5')).toMatchObject({ tintStep: 2 })
    expect(identify('claude-sonnet-4')).toMatchObject({ tintStep: 2 })
  })

  it('treats the bundled latest as newer even when it was never used', () => {
    const identify = buildModelIdentity(['claude-opus-5'])
    expect(identify('claude-opus-5')).toMatchObject({ tintStep: 1, newerKey: 'claude-opus-5-5' })
  })

  it('lets an observed version newer than the bundled latest win', () => {
    const identify = buildModelIdentity(['claude-opus-6', 'claude-opus-5-5'])
    expect(identify('claude-opus-6')).toMatchObject({ tintStep: 0, newerKey: null })
    expect(identify('claude-opus-5-5')).toMatchObject({ tintStep: 1, newerKey: 'claude-opus-6' })
  })

  it('gives a key the same identity whether or not it was in the observed set', () => {
    const identify = buildModelIdentity(['claude-sonnet-5', 'claude-sonnet-5-5'])
    expect(identify('claude-sonnet-4-5')).toMatchObject({
      tintStep: 2,
      newerKey: 'claude-sonnet-5-5'
    })
  })

  it('maps fable to slot 4', () => {
    expect(buildModelIdentity(['claude-fable-5-1'])('claude-fable-5-1')).toEqual({
      family: 'fable',
      slot: 4,
      tintStep: 0,
      newerKey: null
    })
  })

  it('never marks an unknown family, unparseable tail, or unattributed as older-but-colored', () => {
    const identify = buildModelIdentity([
      'claude-nova-1',
      'claude-sonnet-5-5-preview',
      'unattributed'
    ])
    expect(identify('claude-nova-1')).toEqual({
      family: 'nova',
      slot: null,
      tintStep: 0,
      newerKey: null
    })
    expect(identify('claude-sonnet-5-5-preview')).toEqual({
      family: 'sonnet',
      slot: 1,
      tintStep: 0,
      newerKey: null
    })
    expect(identify('unattributed')).toEqual({
      family: null,
      slot: null,
      tintStep: 0,
      newerKey: null
    })
  })
})

describe('seriesColor', () => {
  it('uses the full hue, solid tints, or the quiet fold', () => {
    expect(seriesColor({ family: 'opus', slot: 2, tintStep: 0, newerKey: null })).toBe(
      'var(--usage-series-2)'
    )
    expect(seriesColor({ family: 'opus', slot: 2, tintStep: 1, newerKey: 'x' })).toBe(
      'color-mix(in oklab, var(--usage-series-2) 60%, var(--background))'
    )
    expect(seriesColor({ family: 'opus', slot: 2, tintStep: 2, newerKey: 'x' })).toBe(
      'color-mix(in oklab, var(--usage-series-2) 35%, var(--background))'
    )
    expect(seriesColor({ family: 'nova', slot: null, tintStep: 0, newerKey: null })).toBe(
      'var(--usage-bar-quiet)'
    )
  })
})

describe('groupByFamily', () => {
  const rows = [
    { model: 'claude-sonnet-5', value: 147 },
    { model: 'claude-opus-5-5', value: 60 },
    { model: 'unattributed', value: 90 },
    { model: 'claude-opus-5', value: 36 },
    { model: 'claude-nova-1', value: 200 },
    { model: 'claude-sonnet-5-5', value: 4 },
    { model: 'claude-haiku-4-5', value: 2 }
  ]
  const identify = buildModelIdentity(rows.map((row) => row.model))

  it('orders known families by total, then unknown families, then unattributed; newest first within', () => {
    const groups = groupByFamily(rows, (row) => row.value, identify)
    expect(groups.map((group) => group.key)).toEqual([
      'sonnet',
      'opus',
      'haiku',
      'nova',
      'unattributed'
    ])
    expect(groups[0]).toMatchObject({ total: 151 })
    expect(groups[0].rows.map((row) => row.model)).toEqual(['claude-sonnet-5-5', 'claude-sonnet-5'])
    expect(groups[1].rows.map((row) => row.model)).toEqual(['claude-opus-5-5', 'claude-opus-5'])
  })
})

describe('olderVersionSummary', () => {
  const identify = buildModelIdentity([
    'claude-sonnet-5',
    'claude-sonnet-5-5',
    'claude-opus-5',
    'claude-opus-5-5'
  ])

  it('lists older versions at or above 1% each, cost desc, when they reach 5% together', () => {
    const summary = olderVersionSummary(
      [
        { model: 'claude-opus-5', costUsd: 15 },
        { model: 'claude-sonnet-5', costUsd: 59 },
        { model: 'claude-sonnet-5-5', costUsd: 25.5 },
        { model: 'claude-opus-4', costUsd: 0.5 }
      ],
      100,
      identify
    )
    expect(summary?.share).toBeCloseTo(0.745)
    expect(summary?.items).toEqual([
      { model: 'claude-sonnet-5', newerKey: 'claude-sonnet-5-5' },
      { model: 'claude-opus-5', newerKey: 'claude-opus-5-5' }
    ])
  })

  it('stays quiet below 5%', () => {
    expect(
      olderVersionSummary(
        [
          { model: 'claude-sonnet-5-5', costUsd: 95.1 },
          { model: 'claude-sonnet-5', costUsd: 4.9 }
        ],
        100,
        identify
      )
    ).toBeNull()
  })

  it('stays quiet with no spend', () => {
    expect(olderVersionSummary([], 0, identify)).toBeNull()
  })
})
