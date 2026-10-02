import { describe, expect, it } from 'vitest'
import { estimateResidentTokens } from './token-estimate'

describe('estimateResidentTokens', () => {
  it.each([
    [0, 0],
    [1, 1],
    [3, 1],
    [4, 2]
  ])('ceil-estimates %i characters at one token per three characters as %i', (chars, tokens) => {
    expect(estimateResidentTokens(chars)).toBe(tokens)
  })

  it('rejects invalid character counts', () => {
    expect(() => estimateResidentTokens(-1)).toThrow()
    expect(() => estimateResidentTokens(1.5)).toThrow()
  })
})
