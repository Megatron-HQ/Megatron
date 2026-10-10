import { describe, expect, it } from 'vitest'
import { parseFrontmatterObject } from './frontmatter'
import { parseSkillDirectory } from '../ingest/skill-parser'

describe('frontmatter resource limits', () => {
  it('does not serialize repeated aliases into oversized metadata', () => {
    const block = `name: safe\ndescription: useful\nmetadata:\n  original: &blob "${'x'.repeat(65_536)}"\n  copies: [${Array(40).fill('*blob').join(', ')}]`
    const skill = parseSkillDirectory(
      'synthetic',
      'fallback',
      Buffer.from(`---\n${block}\n---\nBody`)
    )
    expect(skill.metadata_json === null).toBe(true)
    expect(skill).toMatchObject({ name: 'safe', description: 'useful' })
  })

  it('rejects frontmatter too large to parse safely', () => {
    expect(parseFrontmatterObject(`name: safe\nmetadata: "${'x'.repeat(300_000)}"`) === null).toBe(
      true
    )
  })

  it('rejects excessive collection nesting before conversion', () => {
    expect(parseFrontmatterObject(`metadata: ${'['.repeat(100)}1${']'.repeat(100)}`)).toBeNull()
  })
})
