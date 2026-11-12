import { describe, expect, it, vi, type Mock } from 'vitest'
import {
  claimSingleInstance,
  type SingleInstanceApp,
  type RestorableWindow
} from './single-instance'

// Electron's app is the external boundary here: a fake records what Megatron asks of it.
function fakeApp(holdsLock: boolean): SingleInstanceApp & {
  launchAnother: () => void
  quit: Mock<() => void>
} {
  const listeners: (() => void)[] = []
  return {
    requestSingleInstanceLock: () => holdsLock,
    quit: vi.fn<() => void>(),
    on: (_event: 'second-instance', listener: () => void) => {
      listeners.push(listener)
    },
    launchAnother: () => listeners.forEach((listener) => listener())
  }
}

function fakeWindow(minimized: boolean): RestorableWindow & { events: string[] } {
  const events: string[] = []
  let isMinimized = minimized
  return {
    events,
    isMinimized: () => isMinimized,
    restore: () => {
      isMinimized = false
      events.push('restore')
    },
    show: () => events.push('show'),
    focus: () => events.push('focus')
  }
}

describe('single running copy of Megatron', () => {
  it('quits a second launch instead of starting another copy on the same data', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const app = fakeApp(false)
    expect(claimSingleInstance(app, () => [])).toBe(false)
    expect(app.quit).toHaveBeenCalledTimes(1)
    info.mockRestore()
  })

  it('keeps running when it is the only copy', () => {
    const app = fakeApp(true)
    expect(claimSingleInstance(app, () => [])).toBe(true)
    expect(app.quit).not.toHaveBeenCalled()
  })

  it('restores a minimized window and brings it forward when another launch is attempted', () => {
    const app = fakeApp(true)
    const window = fakeWindow(true)
    claimSingleInstance(app, () => [window])
    app.launchAnother()
    expect(window.events).toEqual(['restore', 'show', 'focus'])
  })

  it('brings a visible window forward without restoring it', () => {
    const app = fakeApp(true)
    const window = fakeWindow(false)
    claimSingleInstance(app, () => [window])
    app.launchAnother()
    expect(window.events).toEqual(['show', 'focus'])
  })

  it('ignores another launch that arrives before the first window exists', () => {
    const app = fakeApp(true)
    claimSingleInstance(app, () => [])
    expect(() => app.launchAnother()).not.toThrow()
  })
})
