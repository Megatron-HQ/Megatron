import { describe, expect, it } from 'vitest'
import { parseInvocationPrompt } from './invocation-prompt'

describe('parseInvocationPrompt', () => {
  it('pulls the original dimensions out of an image-caption placeholder', () => {
    const result = parseInvocationPrompt(
      '[Image: original 2438x1460, displayed at 2000x1198. Multiply coordinates by 1.22 to map to original image.]'
    )
    expect(result).toEqual({ kind: 'image', label: 'Image attachment', dimensions: '2438×1460' })
  })

  it('treats any other string as raw text', () => {
    expect(parseInvocationPrompt('/visual-verify run the full sweep')).toEqual({
      kind: 'text',
      label: '/visual-verify run the full sweep'
    })
  })

  it('does not misread a message that merely mentions an image placeholder mid-sentence', () => {
    const msg = 'the [Image: ...] label renders as garbage, can you fix it'
    expect(parseInvocationPrompt(msg)).toEqual({ kind: 'text', label: msg })
  })
})
