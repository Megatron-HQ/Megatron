import { describe, expect, it } from 'vitest'
import { createScanSession } from './scan-session'

describe('createScanSession', () => {
  it('starts a run on the first begin and keeps that start when another begin joins it', () => {
    const session = createScanSession()

    const first = session.begin(1_000)
    const second = session.begin(1_500)

    expect(first).toEqual({
      run: { id: 1, startedAt: 1_000, revealMs: 500 },
      started: true,
      promoted: false
    })
    expect(second).toEqual({
      run: { id: 1, startedAt: 1_000, revealMs: 500 },
      started: false,
      promoted: false
    })
    expect(session.current()).toEqual({ id: 1, startedAt: 1_000, revealMs: 500 })
  })

  it('finishes only when the last joined begin ends, then starts a later run with a new id', () => {
    const session = createScanSession()
    session.begin(1_000)
    session.begin(1_100)

    expect(session.end()).toBeNull()
    expect(session.current()).toEqual({ id: 1, startedAt: 1_000, revealMs: 500 })
    expect(session.end()).toEqual({ id: 1, startedAt: 1_000, revealMs: 500 })
    expect(session.current()).toBeNull()

    expect(session.begin(2_000)).toEqual({
      run: { id: 2, startedAt: 2_000, revealMs: 500 },
      started: true,
      promoted: false
    })
  })

  it('ignores end when nothing is running', () => {
    const session = createScanSession()
    expect(session.end()).toBeNull()
    expect(session.current()).toBeNull()
  })

  it('starts a focus refresh on an 8s reveal and promotes that same run when an announced scan joins', () => {
    const session = createScanSession()

    expect(session.begin(1_000, 'quiet')).toEqual({
      run: { id: 1, startedAt: 1_000, revealMs: 8_000 },
      started: true,
      promoted: false
    })
    expect(session.begin(1_200, 'quiet')).toEqual({
      run: { id: 1, startedAt: 1_000, revealMs: 8_000 },
      started: false,
      promoted: false
    })
    expect(session.begin(1_400, 'announce')).toEqual({
      run: { id: 1, startedAt: 1_000, revealMs: 500 },
      started: false,
      promoted: true
    })
    expect(session.current()).toEqual({ id: 1, startedAt: 1_000, revealMs: 500 })
  })

  it('keeps an announced run on its 500ms reveal when a focus refresh joins it', () => {
    const session = createScanSession()
    session.begin(1_000, 'announce')

    expect(session.begin(1_500, 'quiet')).toEqual({
      run: { id: 1, startedAt: 1_000, revealMs: 500 },
      started: false,
      promoted: false
    })
  })
})
