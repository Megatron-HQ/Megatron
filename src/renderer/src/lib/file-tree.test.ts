import { describe, expect, it } from 'vitest'
import type { SkillFile } from '../../../shared/ipc'
import { buildTree, collectMatchingIds, flattenVisible } from './file-tree'

function file(relativePath: string): SkillFile {
  return { relativePath, content: `content of ${relativePath}`, status: 'ok' }
}

describe('buildTree', () => {
  it('nests a top-level file that sorts alphabetically after a nested path', () => {
    // skill-files.ts sorts by full relative path, so 'zebra.md' sorts after
    // 'references/palette.md' in the flat input — the tree must still place
    // zebra.md at the root, not as a sibling of palette.md.
    const tree = buildTree([file('references/palette.md'), file('zebra.md')])

    expect(tree.map((n) => n.id)).toEqual(['references', 'zebra.md'])
    expect(tree[0].children.map((n) => n.id)).toEqual(['references/palette.md'])
  })

  it('pins SKILL.md first at the root, directories before files otherwise', () => {
    const tree = buildTree([file('zebra.md'), file('references/a.md'), file('SKILL.md')])

    expect(tree.map((n) => n.id)).toEqual(['SKILL.md', 'references', 'zebra.md'])
  })

  it('builds multi-level nesting from forward-slash relative paths', () => {
    const tree = buildTree([file('scripts/cip/generate.py')])

    expect(tree).toEqual([
      expect.objectContaining({
        id: 'scripts',
        isDirectory: true,
        depth: 0,
        children: [
          expect.objectContaining({
            id: 'scripts/cip',
            isDirectory: true,
            depth: 1,
            children: [
              expect.objectContaining({
                id: 'scripts/cip/generate.py',
                isDirectory: false,
                depth: 2
              })
            ]
          })
        ]
      })
    ])
  })
})

describe('collectMatchingIds', () => {
  it('returns null for an empty query', () => {
    const tree = buildTree([file('SKILL.md')])
    expect(collectMatchingIds(tree, '')).toBeNull()
    expect(collectMatchingIds(tree, '   ')).toBeNull()
  })

  it('includes an ancestor directory when only a descendant matches', () => {
    const tree = buildTree([file('references/palette.md'), file('zebra.md')])

    const matches = collectMatchingIds(tree, 'palette')

    expect(matches).toEqual(new Set(['references', 'references/palette.md']))
  })

  it('matches case-insensitively on the node label', () => {
    const tree = buildTree([file('SKILL.md')])
    expect(collectMatchingIds(tree, 'skill')).toEqual(new Set(['SKILL.md']))
  })
})

describe('flattenVisible', () => {
  it('hides children of collapsed directories', () => {
    const tree = buildTree([file('references/palette.md'), file('SKILL.md')])

    const rows = flattenVisible(tree, new Set(), null)

    expect(rows.map((r) => r.node.id)).toEqual(['SKILL.md', 'references'])
  })

  it('shows children of expanded directories, in order', () => {
    const tree = buildTree([file('references/palette.md'), file('SKILL.md')])

    const rows = flattenVisible(tree, new Set(['references']), null)

    expect(rows.map((r) => r.node.id)).toEqual(['SKILL.md', 'references', 'references/palette.md'])
  })

  it('when filtering, only shows matching nodes and their ancestors regardless of expandedIds', () => {
    const tree = buildTree([file('references/palette.md'), file('zebra.md')])
    const matches = collectMatchingIds(tree, 'palette')

    const rows = flattenVisible(tree, new Set(), matches)

    expect(rows.map((r) => r.node.id)).toEqual(['references', 'references/palette.md'])
  })

  it('reports sibling index and count for keyboard navigation', () => {
    const tree = buildTree([file('a.md'), file('b.md'), file('c.md')])

    const rows = flattenVisible(tree, new Set(), null)

    expect(rows.map((r) => [r.siblingIndex, r.siblingCount])).toEqual([
      [0, 3],
      [1, 3],
      [2, 3]
    ])
  })
})
