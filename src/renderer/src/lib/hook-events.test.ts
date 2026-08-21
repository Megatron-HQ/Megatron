import { describe, expect, it } from 'vitest'
import { parseHookEvents } from './hook-events'

describe('parseHookEvents', () => {
  it('parses a JSON array of event names', () => {
    expect(parseHookEvents('["SessionStart","UserPromptSubmit"]')).toEqual([
      'SessionStart',
      'UserPromptSubmit'
    ])
  })

  it('returns an empty array for null', () => {
    expect(parseHookEvents(null)).toEqual([])
  })

  it('returns an empty array for undefined', () => {
    expect(parseHookEvents(undefined)).toEqual([])
  })

  it('returns an empty array for malformed JSON', () => {
    expect(parseHookEvents('{ not valid json')).toEqual([])
  })

  it('returns an empty array when the parsed value is not an array', () => {
    expect(parseHookEvents('{"SessionStart":true}')).toEqual([])
  })
})
