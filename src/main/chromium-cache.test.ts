import { describe, expect, it, vi } from 'vitest'
import { disableChromiumHttpCache } from './chromium-cache'

describe('disableChromiumHttpCache', () => {
  it('disables the Chromium HTTP cache before startup', () => {
    const appendSwitch = vi.fn()

    disableChromiumHttpCache({ appendSwitch })

    expect(appendSwitch).toHaveBeenCalledOnce()
    expect(appendSwitch).toHaveBeenCalledWith('disable-http-cache')
  })
})
