import { describe, expect, it } from 'vitest'
import {
  hasDisableModelInvocationFrontmatter,
  parseExtraFrontmatterFields,
  resolveInternalLink,
  splitFrontmatter
} from './markdown'

describe('splitFrontmatter', () => {
  it('splits a normal frontmatter block from the body', () => {
    const content = '---\nname: x\ndescription: y\n---\n\n# Heading\nBody text\n'
    const result = splitFrontmatter(content)
    expect(result.frontmatter).toBe('name: x\ndescription: y')
    expect(result.body).toBe('\n# Heading\nBody text\n')
  })

  it('returns null frontmatter and the original content when there is no block', () => {
    const content = '# Just a heading\nNo frontmatter here.\n'
    expect(splitFrontmatter(content)).toEqual({ frontmatter: null, body: content })
  })

  it('returns null frontmatter when the block is unterminated', () => {
    const content = '---\nname: x\nno closing marker\n'
    expect(splitFrontmatter(content)).toEqual({ frontmatter: null, body: content })
  })

  it('returns an empty body for a frontmatter-only file', () => {
    const content = '---\nname: x\n---\n'
    const result = splitFrontmatter(content)
    expect(result.frontmatter).toBe('name: x')
    expect(result.body).toBe('')
  })

  it('normalizes CRLF line endings', () => {
    const content = '---\r\nname: x\r\n---\r\nBody\r\n'
    const result = splitFrontmatter(content)
    expect(result.frontmatter).toBe('name: x')
    expect(result.body).toBe('Body\n')
  })
})

describe('resolveInternalLink', () => {
  const files = [
    { relativePath: 'SKILL.md' },
    { relativePath: 'references/architecture.md' },
    { relativePath: 'references/deep/notes.md' },
    { relativePath: 'scripts/build.sh' }
  ]

  it('resolves a same-directory relative link', () => {
    expect(resolveInternalLink('SKILL.md', './scripts/build.sh', files)).toBe('scripts/build.sh')
  })

  it('resolves a link from a nested file back up and across', () => {
    expect(resolveInternalLink('references/architecture.md', '../scripts/build.sh', files)).toBe(
      'scripts/build.sh'
    )
  })

  it('resolves a bare relative path with no leading ./', () => {
    expect(resolveInternalLink('SKILL.md', 'references/architecture.md', files)).toBe(
      'references/architecture.md'
    )
  })

  it('strips a query or fragment suffix before matching', () => {
    expect(resolveInternalLink('SKILL.md', 'references/architecture.md#overview', files)).toBe(
      'references/architecture.md'
    )
  })

  it('returns null for a fragment-only link', () => {
    expect(resolveInternalLink('SKILL.md', '#overview', files)).toBeNull()
  })

  it('returns null for an absolute path', () => {
    expect(resolveInternalLink('SKILL.md', '/etc/passwd', files)).toBeNull()
  })

  it('returns null for a protocol URL', () => {
    expect(resolveInternalLink('SKILL.md', 'https://example.com', files)).toBeNull()
    expect(resolveInternalLink('SKILL.md', 'mailto:a@b.com', files)).toBeNull()
  })

  it('returns null when .. would escape the skill root', () => {
    expect(resolveInternalLink('SKILL.md', '../../outside.md', files)).toBeNull()
  })

  it('returns null when the target file does not exist in the skill', () => {
    expect(resolveInternalLink('SKILL.md', './missing.md', files)).toBeNull()
  })
})

describe('parseExtraFrontmatterFields', () => {
  it('drops name and description, keeps other scalar fields', () => {
    const content = '---\nname: x\ndescription: y\nlicense: MIT\n---\nBody\n'
    expect(parseExtraFrontmatterFields(content)).toEqual([['license', 'MIT']])
  })

  it('returns an empty array when only name and description are present', () => {
    const content = '---\nname: x\ndescription: y\n---\nBody\n'
    expect(parseExtraFrontmatterFields(content)).toEqual([])
  })

  it('returns an empty array when there is no frontmatter', () => {
    expect(parseExtraFrontmatterFields('# No frontmatter\n')).toEqual([])
  })

  it('returns an empty array when the frontmatter fails to parse', () => {
    const content = '---\nname: [unterminated\n---\nBody\n'
    expect(parseExtraFrontmatterFields(content)).toEqual([])
  })

  it('skips non-scalar fields (arrays and objects)', () => {
    const content =
      '---\nname: x\ntags:\n  - a\n  - b\nnested:\n  key: value\ncount: 3\n---\nBody\n'
    expect(parseExtraFrontmatterFields(content)).toEqual([['count', 3]])
  })

  it('drops disable-model-invocation — it is surfaced as its own stat, not a raw badge', () => {
    const content = '---\nname: x\ndisable-model-invocation: true\nlicense: MIT\n---\nBody\n'
    expect(parseExtraFrontmatterFields(content)).toEqual([['license', 'MIT']])
  })
})

describe('hasDisableModelInvocationFrontmatter', () => {
  it('is true for a bare boolean true', () => {
    expect(
      hasDisableModelInvocationFrontmatter(
        '---\nname: x\ndisable-model-invocation: true\n---\nBody\n'
      )
    ).toBe(true)
  })

  it('is false for the quoted string "true" — mirrors the scanner\'s strict === true', () => {
    expect(
      hasDisableModelInvocationFrontmatter(
        '---\nname: x\ndisable-model-invocation: "true"\n---\nBody\n'
      )
    ).toBe(false)
  })

  it('is false when the field is absent, false, or there is no frontmatter', () => {
    expect(hasDisableModelInvocationFrontmatter('---\nname: x\n---\nBody\n')).toBe(false)
    expect(
      hasDisableModelInvocationFrontmatter(
        '---\nname: x\ndisable-model-invocation: false\n---\nBody\n'
      )
    ).toBe(false)
    expect(hasDisableModelInvocationFrontmatter('# No frontmatter\n')).toBe(false)
  })

  it('is false when the frontmatter fails to parse', () => {
    expect(hasDisableModelInvocationFrontmatter('---\nname: [unterminated\n---\nBody\n')).toBe(
      false
    )
  })
})
