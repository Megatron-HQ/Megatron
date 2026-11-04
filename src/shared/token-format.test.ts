import { describe, expect, it } from 'vitest'
import { formatExactTokenCount, formatTokenCount } from './token-format'

describe('token count formatting', () => {
  it.each([
    [0, '0'],
    [1, '1'],
    [999, '999'],
    [1_000, '1K'],
    [1_250, '1.25K'],
    [12_345, '12.35K'],
    [999_994, '999.99K'],
    [999_995, '1M'],
    [1_000_000, '1M'],
    [1_250_000, '1.25M'],
    [999_999_999, '1B'],
    [1_000_000_000, '1B'],
    [2_523_497_582, '2.52B']
  ])(
    'formats %s tokens as %s without losing the unit at a rounding boundary',
    (value, expected) => {
      expect(formatTokenCount(value)).toBe(expected)
    }
  )

  it.each([
    [0, '0'],
    [999, '999'],
    [1_250_000, '1,250,000'],
    [2_523_497_582, '2,523,497,582']
  ])('preserves the exact count for inspecting %s tokens', (value, expected) => {
    expect(formatExactTokenCount(value)).toBe(expected)
  })

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects an invalid token count (%s) instead of displaying misleading text',
    (value) => {
      expect(() => formatTokenCount(value)).toThrow(RangeError)
      expect(() => formatExactTokenCount(value)).toThrow(RangeError)
    }
  )
})
