import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { join, resolve } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  allowedExistsSync,
  allowedReaddirSync,
  getGrantedPaths,
  grantPath,
  isPathAllowed,
  resetGrantedPaths
} from './permissions'

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

describe('getGrantedPaths', () => {
  it('returns an empty array when nothing is granted', () => {
    expect(getGrantedPaths()).toEqual([])
  })

  it('returns a granted path after grantPath', () => {
    const repo = resolve(homedir(), 'Desktop/some-project')
    grantPath(repo)
    expect(getGrantedPaths()).toEqual([repo])
  })

  it('returns the resolved form of a granted path', () => {
    grantPath(resolve(homedir(), 'Desktop/some-project/../some-project'))
    expect(getGrantedPaths()).toEqual([resolve(homedir(), 'Desktop/some-project')])
  })

  it('deduplicates when the same path is granted twice', () => {
    const repo = resolve(homedir(), 'Desktop/some-project')
    grantPath(repo)
    grantPath(repo)
    expect(getGrantedPaths()).toEqual([repo])
  })

  it('does not include the Tier-1 roots', () => {
    const paths = getGrantedPaths()
    expect(paths).not.toContain(resolve(homedir(), '.claude/skills'))
    expect(paths).not.toContain(resolve(homedir(), '.claude/plugins'))
    expect(paths).not.toContain(resolve(homedir(), '.claude/projects'))
  })

  it('empties after resetGrantedPaths', () => {
    grantPath(resolve(homedir(), 'Desktop/some-project'))
    resetGrantedPaths()
    expect(getGrantedPaths()).toEqual([])
  })
})

describe('allowedReaddirSync', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'megatron-perm-test-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns real entries for an allowed directory', () => {
    grantPath(tmpDir)
    mkdirSync(join(tmpDir, 'child-a'))
    mkdirSync(join(tmpDir, 'child-b'))

    expect(allowedReaddirSync(tmpDir).sort()).toEqual(['child-a', 'child-b'])
  })

  it('returns an empty array for a disallowed directory even when it has real entries on disk', () => {
    mkdirSync(join(tmpDir, 'child-a'))

    expect(allowedReaddirSync(tmpDir)).toEqual([])
  })

  it('returns an empty array without throwing when the directory does not exist', () => {
    grantPath(tmpDir)
    expect(() => allowedReaddirSync(join(tmpDir, 'missing'))).not.toThrow()
    expect(allowedReaddirSync(join(tmpDir, 'missing'))).toEqual([])
  })
})

describe('allowedExistsSync', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'megatron-perm-test-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns true for an allowed path that exists', () => {
    grantPath(tmpDir)
    const filePath = join(tmpDir, 'file.txt')
    writeFileSync(filePath, 'content')

    expect(allowedExistsSync(filePath)).toBe(true)
  })

  it('returns false for a disallowed path even when it exists on disk', () => {
    const filePath = join(tmpDir, 'file.txt')
    writeFileSync(filePath, 'content')

    expect(allowedExistsSync(filePath)).toBe(false)
  })

  it('returns false for an allowed path that does not exist', () => {
    grantPath(tmpDir)
    expect(allowedExistsSync(join(tmpDir, 'missing.txt'))).toBe(false)
  })
})
