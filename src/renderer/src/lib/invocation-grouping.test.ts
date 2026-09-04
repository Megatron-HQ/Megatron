import { describe, expect, it } from 'vitest'
import { groupInvocationEntries } from './invocation-grouping'
import type { SkillInvocationEntry, TriggerType } from '../../../shared/ipc'

const IMAGE_TEXT =
  '[Image: original 2400x1460, displayed at 2000x1198. Multiply coordinates by 1.20 to map to original image.]'

function makeEntry(overrides: Partial<SkillInvocationEntry> = {}): SkillInvocationEntry {
  return {
    preceding_user_text: 'do the thing',
    invoked_at: '2024-01-01T00:00:00.000Z',
    trigger_type: 'autonomous',
    cwd: '/repo',
    git_branch: null,
    agent_id: null,
    ...overrides
  }
}

function imageEntry(
  invoked_at: string,
  trigger_type: TriggerType = 'autonomous'
): SkillInvocationEntry {
  return makeEntry({ preceding_user_text: IMAGE_TEXT, invoked_at, trigger_type })
}

describe('groupInvocationEntries', () => {
  it('returns an empty list for no entries', () => {
    expect(groupInvocationEntries([])).toEqual([])
  })

  it('leaves a lone image row as a single item, not a group of one', () => {
    const entry = imageEntry('2024-01-01T00:00:00.000Z')

    expect(groupInvocationEntries([entry])).toEqual([{ kind: 'single', entry }])
  })

  it('leaves a non-image row as a single item', () => {
    const entry = makeEntry({ preceding_user_text: 'Confirmed, go ahead' })

    expect(groupInvocationEntries([entry])).toEqual([{ kind: 'single', entry }])
  })

  it('groups two consecutive image rows seconds apart into one group', () => {
    const newer = imageEntry('2024-01-01T00:00:15.000Z')
    const older = imageEntry('2024-01-01T00:00:00.000Z')

    expect(groupInvocationEntries([newer, older])).toEqual([
      { kind: 'group', entries: [newer, older] }
    ])
  })

  it('does not group image rows more than 15 minutes apart', () => {
    const newer = imageEntry('2024-01-01T00:16:00.000Z')
    const older = imageEntry('2024-01-01T00:00:00.000Z')

    expect(groupInvocationEntries([newer, older])).toEqual([
      { kind: 'single', entry: newer },
      { kind: 'single', entry: older }
    ])
  })

  it('does not group image rows with different trigger types', () => {
    const newer = imageEntry('2024-01-01T00:00:15.000Z', 'user_invoked')
    const older = imageEntry('2024-01-01T00:00:00.000Z', 'autonomous')

    expect(groupInvocationEntries([newer, older])).toEqual([
      { kind: 'single', entry: newer },
      { kind: 'single', entry: older }
    ])
  })

  it('breaks a run at a non-image row and resumes after it', () => {
    const a = imageEntry('2024-01-01T00:00:20.000Z')
    const b = imageEntry('2024-01-01T00:00:10.000Z')
    const middle = makeEntry({
      preceding_user_text: 'Confirmed, go ahead',
      invoked_at: '2024-01-01T00:00:05.000Z'
    })
    const c = imageEntry('2024-01-01T00:00:00.000Z')

    expect(groupInvocationEntries([a, b, middle, c])).toEqual([
      { kind: 'group', entries: [a, b] },
      { kind: 'single', entry: middle },
      { kind: 'single', entry: c }
    ])
  })
})
