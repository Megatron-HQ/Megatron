import { describe, expect, it } from 'vitest'
import { isHiddenProject } from './project-path'

describe('isHiddenProject', () => {
  it('hides a hidden folder and everything inside it', () => {
    const hidden = ['/Users/a/orca/staghorn']
    expect(isHiddenProject('/Users/a/orca/staghorn', hidden)).toBe(true)
    expect(isHiddenProject('/Users/a/orca/staghorn/packages/web', hidden)).toBe(true)
  })

  it('keeps a sibling that only shares a name prefix, and the parent', () => {
    const hidden = ['/Users/a/orca/staghorn']
    expect(isHiddenProject('/Users/a/orca/staghorn-site', hidden)).toBe(false)
    expect(isHiddenProject('/Users/a/orca', hidden)).toBe(false)
  })

  it('matches a Windows path spelled with other separators and drive case', () => {
    expect(isHiddenProject('c:/Code/App/', ['C:\\code\\app'])).toBe(true)
  })

  it('hides nothing when no folder is hidden', () => {
    expect(isHiddenProject('/Users/a/orca/staghorn', [])).toBe(false)
  })
})
