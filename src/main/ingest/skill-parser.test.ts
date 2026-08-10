import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { grantPath, resetGrantedPaths } from '../permissions'
import { parseSkillDirectory } from './skill-parser'

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'megatron-test-'))
  grantPath(tmpDir)
})

afterEach(() => {
  resetGrantedPaths()
  rmSync(tmpDir, { recursive: true, force: true })
})

function writeSkill(dirName: string, content: string): string {
  const dirPath = join(tmpDir, dirName)
  mkdirSync(dirPath, { recursive: true })
  writeFileSync(join(dirPath, 'SKILL.md'), content)
  return dirPath
}

describe('parseSkillDirectory', () => {
  it('parses a valid name and description', () => {
    const dirPath = writeSkill(
      'my-skill',
      '---\nname: my-skill\ndescription: Does a thing\n---\nBody'
    )
    expect(parseSkillDirectory(dirPath)).toEqual({ name: 'my-skill', description: 'Does a thing' })
  })

  it('frontmatter name overrides the directory basename', () => {
    const dirPath = writeSkill(
      'dir-name',
      '---\nname: frontmatter-name\ndescription: A skill\n---\nBody'
    )
    expect(parseSkillDirectory(dirPath).name).toBe('frontmatter-name')
  })

  it('falls back to the directory basename when name key is absent, but keeps description', () => {
    const dirPath = writeSkill('dir-name', '---\ndescription: A skill\n---\nBody')
    expect(parseSkillDirectory(dirPath)).toEqual({ name: 'dir-name', description: 'A skill' })
  })

  it('falls back to basename and null description when there is no frontmatter block', () => {
    const dirPath = writeSkill('dir-name', 'Just a body, no frontmatter at all')
    expect(parseSkillDirectory(dirPath)).toEqual({ name: 'dir-name', description: null })
  })

  it('falls back to basename and null description on malformed YAML, without throwing', () => {
    const dirPath = writeSkill(
      'dir-name',
      '---\nname: my-skill\ndescription: Use when X: do Y\n---\nBody'
    )
    expect(() => parseSkillDirectory(dirPath)).not.toThrow()
    expect(parseSkillDirectory(dirPath)).toEqual({ name: 'dir-name', description: null })
  })

  it('returns null description when the description key is absent', () => {
    const dirPath = writeSkill('my-skill', '---\nname: my-skill\n---\nBody')
    expect(parseSkillDirectory(dirPath)).toEqual({ name: 'my-skill', description: null })
  })

  it('treats a whitespace-only description as null, not empty string', () => {
    const dirPath = writeSkill('my-skill', '---\nname: my-skill\ndescription: "   "\n---\nBody')
    expect(parseSkillDirectory(dirPath).description).toBeNull()
  })

  it('falls back to the directory basename when frontmatter name is empty', () => {
    const dirPath = writeSkill('dir-name', '---\nname: ""\ndescription: A skill\n---\nBody')
    expect(parseSkillDirectory(dirPath)).toEqual({ name: 'dir-name', description: 'A skill' })
  })

  it('falls back to basename and null description when SKILL.md does not exist', () => {
    const dirPath = join(tmpDir, 'no-skill-md')
    mkdirSync(dirPath, { recursive: true })
    expect(parseSkillDirectory(dirPath)).toEqual({ name: 'no-skill-md', description: null })
  })

  it('falls back when the frontmatter block parses to a non-mapping scalar', () => {
    const dirPath = writeSkill('dir-name', '---\njust a plain scalar\n---\nBody')
    expect(parseSkillDirectory(dirPath)).toEqual({ name: 'dir-name', description: null })
  })

  it('falls back when the frontmatter block parses to a list', () => {
    const dirPath = writeSkill('dir-name', '---\n- one\n- two\n---\nBody')
    expect(parseSkillDirectory(dirPath)).toEqual({ name: 'dir-name', description: null })
  })

  it('treats a non-string description as null while still honoring name', () => {
    const dirPath = writeSkill('dir-name', '---\nname: my-skill\ndescription: 42\n---\nBody')
    expect(parseSkillDirectory(dirPath)).toEqual({ name: 'my-skill', description: null })
  })

  it('ignores unknown extra frontmatter keys without throwing', () => {
    const dirPath = writeSkill(
      'my-skill',
      '---\nname: my-skill\ndescription: A skill\nunknown_key: whatever\n---\nBody'
    )
    expect(() => parseSkillDirectory(dirPath)).not.toThrow()
    expect(parseSkillDirectory(dirPath)).toEqual({ name: 'my-skill', description: 'A skill' })
  })

  it('falls back without reading when the path is outside every allowed root', () => {
    resetGrantedPaths()
    const dirPath = writeSkill(
      'my-skill',
      '---\nname: real-name\ndescription: Real desc\n---\nBody'
    )
    expect(parseSkillDirectory(dirPath)).toEqual({ name: 'my-skill', description: null })
  })

  it('falls back when the frontmatter block has no closing delimiter before EOF', () => {
    const dirPath = writeSkill(
      'dir-name',
      '---\nname: my-skill\ndescription: A skill\nno closing delimiter'
    )
    expect(parseSkillDirectory(dirPath)).toEqual({ name: 'dir-name', description: null })
  })
})
