import { describe, expect, it } from 'vitest'
import * as rule from './broken-file-paths'

const extract = (
  rule as typeof rule & {
    extractMarkdownLinkTargets?: (line: string) => string[]
  }
).extractMarkdownLinkTargets

describe('bounded Markdown link extraction', () => {
  it.each([
    [
      '[guide](./docs/guide.md "Guide") [next](scripts/next.py)',
      ['./docs/guide.md "Guide"', 'scripts/next.py']
    ],
    ['[unclosed](no-end', []],
    ['[label [nested]](docs/nested.md)', ['docs/nested.md']],
    ['\\[literal](skip.md) [real](docs/real.md)', ['docs/real.md']],
    ['[file](docs/a\\)b.md)', ['docs/a\\)b.md']]
  ])('extracts targets from %s', (input, expected) => {
    expect(extract?.(input as string)).toEqual(expected)
  })

  it('handles a large unmatched label without restarting at each opening bracket', () => {
    expect(extract?.('['.repeat(128_000))).toEqual([])
  })
})
