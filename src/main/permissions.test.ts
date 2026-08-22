import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { join, resolve } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  allowedExistsSync,
  allowedReaddirSync,
  allowedReadFileSync,
  allowedRealpathSync,
  allowedStatSync,
  getGrantedPaths,
  grantPath,
  isPathAllowed,
  readAllowedDirectory,
  resetGrantedPaths,
  revokePath
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

  it('rejects ~/.claude itself and other sibling files, not just other roots', () => {
    expect(isPathAllowed(resolve(homedir(), '.claude'))).toBe(false)
    expect(isPathAllowed(resolve(homedir(), '.claude/CLAUDE.md'))).toBe(false)
  })

  it('allows ~/.claude.json so the MCP linter can read user-level server config', () => {
    expect(isPathAllowed(resolve(homedir(), '.claude.json'))).toBe(true)
  })

  it('allows ~/.claude/settings.json so scans can read enabledPlugins/skillOverrides', () => {
    expect(isPathAllowed(resolve(homedir(), '.claude/settings.json'))).toBe(true)
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

  it('allows a Tier-1 path when only the drive-letter case differs on win32', () => {
    if (process.platform !== 'win32') return
    const skillMd = resolve(homedir(), '.claude/skills/some-skill/SKILL.md')
    const flipped = skillMd.replace(/^[A-Za-z]/, (ch) =>
      ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase()
    )
    expect(flipped).not.toBe(skillMd)
    expect(isPathAllowed(flipped)).toBe(true)
    expect(
      isPathAllowed(
        resolve(homedir(), '.claude.json').replace(/^[A-Za-z]/, (ch) =>
          ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase()
        )
      )
    ).toBe(true)
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

describe('revokePath', () => {
  it('removes a granted path from granted paths', () => {
    const repo = resolve(homedir(), 'Desktop/some-project')
    grantPath(repo)
    expect(getGrantedPaths()).toEqual([repo])
    expect(isPathAllowed(repo)).toBe(true)

    revokePath(repo)
    expect(getGrantedPaths()).toEqual([])
    expect(isPathAllowed(repo)).toBe(false)
  })

  it('removes the resolved form of a path', () => {
    const repo = resolve(homedir(), 'Desktop/some-project')
    grantPath(repo)
    revokePath(resolve(homedir(), 'Desktop/some-project/../some-project'))
    expect(getGrantedPaths()).toEqual([])
    expect(isPathAllowed(repo)).toBe(false)
  })

  it('no-ops when revoking a path that was not granted', () => {
    const repo1 = resolve(homedir(), 'Desktop/repo-1')
    const repo2 = resolve(homedir(), 'Desktop/repo-2')
    grantPath(repo1)
    expect(() => revokePath(repo2)).not.toThrow()
    expect(getGrantedPaths()).toEqual([repo1])
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

describe('readAllowedDirectory', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'megatron-perm-test-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('distinguishes empty, missing, and unavailable directories', () => {
    grantPath(tmpDir)

    expect(readAllowedDirectory(tmpDir)).toEqual({ entries: [], status: 'ok' })
    expect(readAllowedDirectory(join(tmpDir, 'missing'))).toEqual({
      entries: [],
      status: 'missing'
    })

    resetGrantedPaths()
    expect(readAllowedDirectory(tmpDir)).toEqual({ entries: [], status: 'unavailable' })
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

describe('allowedStatSync', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'megatron-perm-test-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns stats for an allowed path that exists', () => {
    grantPath(tmpDir)
    const filePath = join(tmpDir, 'file.txt')
    writeFileSync(filePath, 'content')

    expect(allowedStatSync(filePath)?.isFile()).toBe(true)
  })

  it('returns null for a disallowed path even when it exists on disk', () => {
    const filePath = join(tmpDir, 'file.txt')
    writeFileSync(filePath, 'content')

    expect(allowedStatSync(filePath)).toBeNull()
  })

  it('returns null for an allowed path that does not exist', () => {
    grantPath(tmpDir)
    expect(allowedStatSync(join(tmpDir, 'missing.txt'))).toBeNull()
  })
})

describe('allowedRealpathSync', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'megatron-perm-test-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns the same canonical path for an allowed directory and its symlink', () => {
    grantPath(tmpDir)
    const target = join(tmpDir, 'target')
    mkdirSync(target)
    const link = join(tmpDir, 'link')
    symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir')

    expect(allowedRealpathSync(link)).toBe(allowedRealpathSync(target))
  })
})

describe('allowedReadFileSync', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'megatron-perm-test-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns file contents as a Buffer for an allowed path', () => {
    grantPath(tmpDir)
    const filePath = join(tmpDir, 'file.txt')
    writeFileSync(filePath, 'content')

    expect(allowedReadFileSync(filePath)?.toString('utf8')).toBe('content')
  })

  it('returns null for a disallowed path even when it exists on disk', () => {
    const filePath = join(tmpDir, 'file.txt')
    writeFileSync(filePath, 'content')

    expect(allowedReadFileSync(filePath)).toBeNull()
  })

  it('returns null for an allowed path that does not exist', () => {
    grantPath(tmpDir)
    expect(allowedReadFileSync(join(tmpDir, 'missing.txt'))).toBeNull()
  })
})
