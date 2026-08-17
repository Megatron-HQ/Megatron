import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { grantPath, resetGrantedPaths } from './permissions'
import { readSkillFiles, readSkillMd } from './skill-files'

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'megatron-skill-files-test-'))
  resetGrantedPaths()
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('readSkillFiles', () => {
  it('returns an empty array for a disallowed directory', () => {
    writeFileSync(join(tmpDir, 'SKILL.md'), '---\nname: test\n---\nBody')

    expect(readSkillFiles(tmpDir)).toEqual([])
  })

  it('reads a flat directory, returning file content', () => {
    grantPath(tmpDir)
    writeFileSync(join(tmpDir, 'SKILL.md'), '---\nname: test\n---\nBody')

    expect(readSkillFiles(tmpDir)).toEqual([
      { relativePath: 'SKILL.md', content: '---\nname: test\n---\nBody', status: 'ok' }
    ])
  })

  it('walks nested directories using forward-slash relative paths', () => {
    grantPath(tmpDir)
    writeFileSync(join(tmpDir, 'SKILL.md'), 'skill body')
    mkdirSync(join(tmpDir, 'references'))
    writeFileSync(join(tmpDir, 'references', 'palette.md'), 'palette body')

    const files = readSkillFiles(tmpDir)

    expect(files.map((f) => f.relativePath)).toEqual(['SKILL.md', 'references/palette.md'])
  })

  it('sorts SKILL.md first regardless of alphabetical order', () => {
    grantPath(tmpDir)
    writeFileSync(join(tmpDir, 'AAA-comes-first-alphabetically.md'), 'a')
    writeFileSync(join(tmpDir, 'SKILL.md'), 'skill body')

    const files = readSkillFiles(tmpDir)

    expect(files[0].relativePath).toBe('SKILL.md')
  })

  it('skips dotfiles and dot-directories', () => {
    grantPath(tmpDir)
    writeFileSync(join(tmpDir, 'SKILL.md'), 'skill body')
    writeFileSync(join(tmpDir, '.DS_Store'), 'junk')
    mkdirSync(join(tmpDir, '.git'))
    writeFileSync(join(tmpDir, '.git', 'config'), 'junk')

    const files = readSkillFiles(tmpDir)

    expect(files.map((f) => f.relativePath)).toEqual(['SKILL.md'])
  })

  it('marks a file over the size cap as too_large with null content', () => {
    grantPath(tmpDir)
    writeFileSync(join(tmpDir, 'SKILL.md'), 'skill body')
    writeFileSync(join(tmpDir, 'huge.csv'), 'x'.repeat(256 * 1024 + 1))

    const huge = readSkillFiles(tmpDir).find((f) => f.relativePath === 'huge.csv')

    expect(huge).toEqual({ relativePath: 'huge.csv', content: null, status: 'too_large' })
  })

  it('marks a binary file (containing a NUL byte) as unreadable', () => {
    grantPath(tmpDir)
    writeFileSync(join(tmpDir, 'SKILL.md'), 'skill body')
    writeFileSync(join(tmpDir, 'binary.dat'), Buffer.from([0x00, 0x01, 0x02]))

    const binary = readSkillFiles(tmpDir).find((f) => f.relativePath === 'binary.dat')

    expect(binary).toEqual({ relativePath: 'binary.dat', content: null, status: 'unreadable' })
  })
})

describe('readSkillMd', () => {
  it('reads only SKILL.md, ignoring every other file in the directory', () => {
    grantPath(tmpDir)
    writeFileSync(join(tmpDir, 'SKILL.md'), '---\nname: test\n---\nBody')
    mkdirSync(join(tmpDir, 'references'))
    writeFileSync(join(tmpDir, 'references', 'palette.md'), 'x'.repeat(300 * 1024))

    expect(readSkillMd(tmpDir)).toEqual({
      relativePath: 'SKILL.md',
      content: '---\nname: test\n---\nBody',
      status: 'ok'
    })
  })

  it('returns null for a disallowed directory', () => {
    writeFileSync(join(tmpDir, 'SKILL.md'), '---\nname: test\n---\nBody')

    expect(readSkillMd(tmpDir)).toBeNull()
  })

  it('returns null when SKILL.md does not exist', () => {
    grantPath(tmpDir)

    expect(readSkillMd(tmpDir)).toBeNull()
  })
})
