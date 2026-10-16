import { describe, expect, it } from 'vitest'
import { createScanSession } from './scan-session'

describe('createScanSession', () => {
  it('starts a run on the first begin and keeps that start when another begin joins it', () => {
    const session = createScanSession()

    const first = session.begin(1_000)
    const second = session.begin(1_500)

    expect(first).toEqual({ run: { id: 1, startedAt: 1_000 }, started: true })
    expect(second).toEqual({ run: { id: 1, startedAt: 1_000 }, started: false })
    expect(session.current()).toEqual({ id: 1, startedAt: 1_000 })
  })

  it('finishes only when the last joined begin ends, then starts a later run with a new id', () => {
    const session = createScanSession()
    session.begin(1_000)
    session.begin(1_100)

    expect(session.end()).toBeNull()
    expect(session.current()).toEqual({ id: 1, startedAt: 1_000 })
    expect(session.end()).toEqual({ id: 1, startedAt: 1_000 })
    expect(session.current()).toBeNull()

    expect(session.begin(2_000)).toEqual({
      run: { id: 2, startedAt: 2_000 },
      started: true
    })
  })

  it('ignores end when nothing is running', () => {
    const session = createScanSession()
    expect(session.end()).toBeNull()
    expect(session.current()).toBeNull()
  })
})
