import { homedir } from 'os'
import { resolve } from 'path'
import { beforeEach, describe, expect, it } from 'vitest'
import { grantPath, isPathAllowed, resetGrantedPaths } from './permissions'

beforeEach(() => {
  resetGrantedPaths()
})

describe('isPathAllowed', () => {
  it('allows Tier-1 ~/.claude subdirectories', () => {
    expect(isPathAllowed(resolve(homedir(), '.claude/skills'))).toBe(true)
    expect(isPathAllowed(resolve(homedir(), '.claude/plugins/installed_plugins.json'))).toBe(true)
    expect(isPathAllowed(resolve(homedir(), '.claude/projects/some-project/session.jsonl'))).toBe(
      true
    )
  })

  it('rejects paths outside any allowed root', () => {
    expect(isPathAllowed(resolve(homedir(), 'Desktop/some-other-repo'))).toBe(false)
    expect(isPathAllowed('/etc/passwd')).toBe(false)
  })

  it('rejects ~/.claude itself and sibling files, not just other roots', () => {
    expect(isPathAllowed(resolve(homedir(), '.claude'))).toBe(false)
    expect(isPathAllowed(resolve(homedir(), '.claude/settings.json'))).toBe(false)
  })

  it('rejects traversal that escapes an allowed root', () => {
    expect(isPathAllowed(resolve(homedir(), '.claude/skills/../../etc/passwd'))).toBe(false)
    expect(isPathAllowed(resolve(homedir(), '.claude/skills-evil'))).toBe(false)
  })

  it('allows a granted Tier-2 path and its children only after grantPath', () => {
    const repo = resolve(homedir(), 'Desktop/some-project')
    expect(isPathAllowed(repo)).toBe(false)
    grantPath(repo)
    expect(isPathAllowed(repo)).toBe(true)
    expect(isPathAllowed(resolve(repo, '.claude/skills'))).toBe(true)
    expect(isPathAllowed(resolve(homedir(), 'Desktop/some-project-2'))).toBe(false)
  })
})
