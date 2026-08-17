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
    expect(parseSkillDirectory(dirPath)).toEqual({
      name: 'my-skill',
      description: 'Does a thing',
      est_listing_tokens: 5,
      est_body_tokens: 13
    })
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
    expect(parseSkillDirectory(dirPath)).toEqual({
      name: 'dir-name',
      description: 'A skill',
      est_listing_tokens: 4,
      est_body_tokens: 8
    })
  })

  it('falls back to basename and null description when there is no frontmatter block', () => {
    const dirPath = writeSkill('dir-name', 'Just a body, no frontmatter at all')
    expect(parseSkillDirectory(dirPath)).toEqual({
      name: 'dir-name',
      description: null,
      est_listing_tokens: 2,
      est_body_tokens: 9
    })
  })

  it('falls back to basename and null description on malformed YAML, without throwing', () => {
    const dirPath = writeSkill(
      'dir-name',
      '---\nname: my-skill\ndescription: Use when X: do Y\n---\nBody'
    )
    expect(() => parseSkillDirectory(dirPath)).not.toThrow()
    expect(parseSkillDirectory(dirPath)).toEqual({
      name: 'dir-name',
      description: null,
      est_listing_tokens: 2,
      est_body_tokens: 14
    })
  })

  it('returns null description when the description key is absent', () => {
    const dirPath = writeSkill('my-skill', '---\nname: my-skill\n---\nBody')
    expect(parseSkillDirectory(dirPath)).toEqual({
      name: 'my-skill',
      description: null,
      est_listing_tokens: 2,
      est_body_tokens: 7
    })
  })

  it('treats a whitespace-only description as null, not empty string', () => {
    const dirPath = writeSkill('my-skill', '---\nname: my-skill\ndescription: "   "\n---\nBody')
    expect(parseSkillDirectory(dirPath).description).toBeNull()
  })

  it('falls back to the directory basename when frontmatter name is empty', () => {
    const dirPath = writeSkill('dir-name', '---\nname: ""\ndescription: A skill\n---\nBody')
    expect(parseSkillDirectory(dirPath)).toEqual({
      name: 'dir-name',
      description: 'A skill',
      est_listing_tokens: 4,
      est_body_tokens: 11
    })
  })

  it('falls back to basename and null description when SKILL.md does not exist', () => {
    const dirPath = join(tmpDir, 'no-skill-md')
    mkdirSync(dirPath, { recursive: true })
    expect(parseSkillDirectory(dirPath)).toEqual({
      name: 'no-skill-md',
      description: null,
      est_listing_tokens: 0,
      est_body_tokens: 0
    })
  })

  it('falls back when the frontmatter block parses to a non-mapping scalar', () => {
    const dirPath = writeSkill('dir-name', '---\njust a plain scalar\n---\nBody')
    expect(parseSkillDirectory(dirPath)).toEqual({
      name: 'dir-name',
      description: null,
      est_listing_tokens: 2,
      est_body_tokens: 8
    })
  })

  it('falls back when the frontmatter block parses to a list', () => {
    const dirPath = writeSkill('dir-name', '---\n- one\n- two\n---\nBody')
    expect(parseSkillDirectory(dirPath)).toEqual({
      name: 'dir-name',
      description: null,
      est_listing_tokens: 2,
      est_body_tokens: 6
    })
  })

  it('treats a non-string description as null while still honoring name', () => {
    const dirPath = writeSkill('dir-name', '---\nname: my-skill\ndescription: 42\n---\nBody')
    expect(parseSkillDirectory(dirPath)).toEqual({
      name: 'my-skill',
      description: null,
      est_listing_tokens: 2,
      est_body_tokens: 11
    })
  })

  it('ignores unknown extra frontmatter keys without throwing', () => {
    const dirPath = writeSkill(
      'my-skill',
      '---\nname: my-skill\ndescription: A skill\nunknown_key: whatever\n---\nBody'
    )
    expect(() => parseSkillDirectory(dirPath)).not.toThrow()
    expect(parseSkillDirectory(dirPath)).toEqual({
      name: 'my-skill',
      description: 'A skill',
      est_listing_tokens: 4,
      est_body_tokens: 18
    })
  })

  it('falls back without reading when the path is outside every allowed root', () => {
    resetGrantedPaths()
    const dirPath = writeSkill(
      'my-skill',
      '---\nname: real-name\ndescription: Real desc\n---\nBody'
    )
    expect(parseSkillDirectory(dirPath)).toEqual({
      name: 'my-skill',
      description: null,
      est_listing_tokens: 0,
      est_body_tokens: 0
    })
  })

  it('falls back when the frontmatter block has no closing delimiter before EOF', () => {
    const dirPath = writeSkill(
      'dir-name',
      '---\nname: my-skill\ndescription: A skill\nno closing delimiter'
    )
    expect(parseSkillDirectory(dirPath)).toEqual({
      name: 'dir-name',
      description: null,
      est_listing_tokens: 2,
      est_body_tokens: 15
    })
  })

  it('rounds half up rather than flooring — a 2-char name alone is 1 token, not 0', () => {
    const dirPath = writeSkill('ab', '---\nname: ab\n---\nBody')
    expect(parseSkillDirectory(dirPath).est_listing_tokens).toBe(1)
  })

  it('joins name and description with no trailing space when description is null', () => {
    // "nine-char" = 9 chars -> round(9/4) = 2. If a stray join space survived instead of
    // filter(Boolean) dropping it, the estimate would be based on "nine-char " (10 chars) ->
    // round(10/4) = 3 — chosen so the two diverge.
    const dirPath = writeSkill('nine-char', '---\nname: nine-char\n---\nBody')
    expect(parseSkillDirectory(dirPath).est_listing_tokens).toBe(2)
  })

  it('caps the description at 1536 chars before counting listing tokens', () => {
    const longDescription = 'a'.repeat(2000)
    const dirPath = writeSkill(
      'my-skill',
      `---\nname: my-skill\ndescription: ${longDescription}\n---\nBody`
    )
    // capped: "my-skill" (8) + " " (1) + 1536 a's = 1545 chars -> round(1545/4) = 386
    expect(parseSkillDirectory(dirPath).est_listing_tokens).toBe(386)
  })

  it('measures listing tokens by JS string length, not UTF-8 byte length', () => {
    // "café — test" is 11 JS chars but more UTF-8 bytes (é and — are multi-byte).
    const dirPath = writeSkill('multibyte-skill', '---\nname: café — test\n---\nBody')
    // "café — test" = 11 chars -> round(11/4) = 3
    expect(parseSkillDirectory(dirPath).est_listing_tokens).toBe(3)
  })
})
