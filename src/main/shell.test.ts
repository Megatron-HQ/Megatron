import { describe, expect, it } from 'vitest'
import { isSafeExternalUrl } from './shell'

describe('isSafeExternalUrl', () => {
  it('allows https URLs', () => {
    expect(isSafeExternalUrl('https://example.com/docs')).toBe(true)
  })

  it('allows http URLs', () => {
    expect(isSafeExternalUrl('http://example.com')).toBe(true)
  })

  it('rejects file URLs', () => {
    expect(isSafeExternalUrl('file:///etc/passwd')).toBe(false)
  })

  it('rejects javascript URLs', () => {
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false)
  })

  it('rejects data URLs', () => {
    expect(isSafeExternalUrl('data:text/html,<script>alert(1)</script>')).toBe(false)
  })

  it('rejects unparseable input', () => {
    expect(isSafeExternalUrl('not a url')).toBe(false)
  })
})
