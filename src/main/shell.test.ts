import { describe, expect, it } from 'vitest'
import { isSafeExternalUrl, openSafeExternal } from './shell'

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

  it('opens only URLs accepted by the shared safety policy', () => {
    const opened: string[] = []
    const open = (url: string): void => {
      opened.push(url)
    }

    expect(openSafeExternal('https://example.com/docs', open)).toBe(true)
    expect(openSafeExternal('file:///etc/passwd', open)).toBe(false)

    expect(opened).toEqual(['https://example.com/docs'])
  })
})
