import { describe, expect, it } from 'vitest'
import { buildModelIdentity } from '../../lib/model-identity'
import { buildShareBars, percentLabel } from './share-bars'

const identify = buildModelIdentity([])

interface Row {
  model: string
  turns: number
  tokens: number
}

const turns = (row: Row): number => row.turns
const tokens = (row: Row): number => row.tokens

describe('percentLabel', () => {
  it('rounds to whole percents, floors visible slivers at <1%, and reads zero as 0%', () => {
    expect(percentLabel(71, 100)).toBe('71%')
    expect(percentLabel(0.4, 100)).toBe('<1%')
    expect(percentLabel(0, 100)).toBe('0%')
    expect(percentLabel(5, 0)).toBe('0%')
  })
})

describe('buildShareBars', () => {
  const rows: Row[] = [
    { model: 'claude-haiku-4-5', turns: 34, tokens: 30 },
    { model: 'claude-opus-5-5', turns: 679, tokens: 900 },
    { model: 'claude-sonnet-5', turns: 2250, tokens: 600 }
  ]

  it('orders every bar by the first series, even when a later series ranks differently', () => {
    const { groups, bars } = buildShareBars(
      rows,
      [
        { label: 'Turns', value: turns, total: 2963 },
        { label: 'Output', value: tokens, total: 1530 }
      ],
      identify
    )
    expect(groups.map((group) => group.key)).toEqual(['sonnet', 'opus', 'haiku'])
    expect(bars[1].segments.map((segment) => segment.row.model)).toEqual([
      'claude-sonnet-5',
      'claude-opus-5-5',
      'claude-haiku-4-5'
    ])
    expect(bars.map((bar) => bar.label)).toEqual(['Turns', 'Output'])
  })

  it('leaves trailing slack when the total exceeds the rows (a priced undercount)', () => {
    const { bars } = buildShareBars(
      [{ model: 'claude-opus-5-5', turns: 60, tokens: 0 }],
      [{ value: turns, total: 100 }],
      identify
    )
    expect(bars[0].segments[0].fraction).toBe(0.6)
  })

  it('never overflows when the rows exceed the total', () => {
    const { bars } = buildShareBars(
      [{ model: 'claude-opus-5-5', turns: 120, tokens: 0 }],
      [{ value: turns, total: 100 }],
      identify
    )
    expect(bars[0].segments[0].fraction).toBe(1)
  })

  it('drops zero-value segments from a bar but still labels their share', () => {
    const zeroTokens: Row[] = [
      { model: 'claude-sonnet-5', turns: 10, tokens: 50 },
      { model: 'claude-haiku-4-5', turns: 5, tokens: 0 }
    ]
    const { bars, measure } = buildShareBars(
      zeroTokens,
      [
        { value: turns, total: 15 },
        { value: tokens, total: 50 }
      ],
      identify
    )
    expect(bars[1].segments.map((segment) => segment.row.model)).toEqual(['claude-sonnet-5'])
    expect(measure([zeroTokens[1]])).toEqual({ values: [5, 0], shares: ['33%', '0%'] })
  })

  it('sums a family before taking its share', () => {
    const family: Row[] = [
      { model: 'claude-sonnet-5-5', turns: 30, tokens: 0 },
      { model: 'claude-sonnet-5', turns: 40, tokens: 0 },
      { model: 'claude-opus-5-5', turns: 30, tokens: 0 }
    ]
    const { groups, measure } = buildShareBars(family, [{ value: turns, total: 100 }], identify)
    expect(measure(groups[0].rows)).toEqual({ values: [70], shares: ['70%'] })
  })

  it('continues the stagger order across bars so the second bar animates after the first', () => {
    const { bars } = buildShareBars(
      rows,
      [
        { value: turns, total: 2963 },
        { value: tokens, total: 1530 }
      ],
      identify
    )
    expect(bars[0].segments.map((segment) => segment.order)).toEqual([0, 1, 2])
    expect(bars[1].segments.map((segment) => segment.order)).toEqual([3, 4, 5])
  })

  it('tags each segment with its family for family-level hover', () => {
    const { bars } = buildShareBars(rows, [{ value: turns, total: 2963 }], identify)
    expect(bars[0].segments.map((segment) => segment.family)).toEqual(['sonnet', 'opus', 'haiku'])
  })
})
