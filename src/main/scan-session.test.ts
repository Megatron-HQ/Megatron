import { describe, expect, it } from 'vitest'
import { createScanSession } from './scan-session'

describe('createScanSession', () => {
  it('marks startup progress eligible and keeps subsequent focus and manual scans ineligible', () => {
    const session = createScanSession()
    expect(session.begin(1_000, 'startup').run).toMatchObject({ isStartup: true, revealMs: 500 })
    session.end()
    expect(session.begin(2_000, 'quiet').run).toMatchObject({ isStartup: false })
    session.end()
    expect(session.begin(3_000).run).toMatchObject({ isStartup: false })
  })

  it('keeps startup eligibility when a manual scan joins, and resets it on a new session', () => {
    const session = createScanSession()
    session.begin(1_000, 'startup')
    expect(session.begin(1_100).run).toMatchObject({ isStartup: true, startedAt: 1_000 })
    expect(session.end()).toBeNull()
    expect(session.end()).toMatchObject({ isStartup: true })
    expect(createScanSession().begin(2_000, 'startup').run).toMatchObject({ isStartup: true })
  })

  it('announces startup when it joins an already announced run', () => {
    const session = createScanSession()
    session.begin(1_000)
    expect(session.begin(1_100, 'startup')).toMatchObject({
      run: { isStartup: true, startedAt: 1_000 },
      started: false,
      promoted: true
    })
  })

  it('starts a run on the first begin and keeps that start when another begin joins it', () => {
    const session = createScanSession()

    const first = session.begin(1_000)
    const second = session.begin(1_500)

    expect(first).toEqual({
      run: { id: 1, startedAt: 1_000, revealMs: 500, isStartup: false },
      started: true,
      promoted: false
    })
    expect(second).toEqual({
      run: { id: 1, startedAt: 1_000, revealMs: 500, isStartup: false },
      started: false,
      promoted: false
    })
    expect(session.current()).toEqual({ id: 1, startedAt: 1_000, revealMs: 500, isStartup: false })
  })

  it('finishes only when the last joined begin ends, then starts a later run with a new id', () => {
    const session = createScanSession()
    session.begin(1_000)
    session.begin(1_100)

    expect(session.end()).toBeNull()
    expect(session.current()).toEqual({ id: 1, startedAt: 1_000, revealMs: 500, isStartup: false })
    expect(session.end()).toEqual({ id: 1, startedAt: 1_000, revealMs: 500, isStartup: false })
    expect(session.current()).toBeNull()

    expect(session.begin(2_000)).toEqual({
      run: { id: 2, startedAt: 2_000, revealMs: 500, isStartup: false },
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
      run: { id: 1, startedAt: 1_000, revealMs: 8_000, isStartup: false },
      started: true,
      promoted: false
    })
    expect(session.begin(1_200, 'quiet')).toEqual({
      run: { id: 1, startedAt: 1_000, revealMs: 8_000, isStartup: false },
      started: false,
      promoted: false
    })
    expect(session.begin(1_400, 'announce')).toEqual({
      run: { id: 1, startedAt: 1_000, revealMs: 500, isStartup: false },
      started: false,
      promoted: true
    })
    expect(session.current()).toEqual({ id: 1, startedAt: 1_000, revealMs: 500, isStartup: false })
  })

  it('keeps an announced run on its 500ms reveal when a focus refresh joins it', () => {
    const session = createScanSession()
    session.begin(1_000, 'announce')

    expect(session.begin(1_500, 'quiet')).toEqual({
      run: { id: 1, startedAt: 1_000, revealMs: 500, isStartup: false },
      started: false,
      promoted: false
    })
  })
})
