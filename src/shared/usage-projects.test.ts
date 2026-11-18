import { describe, expect, it } from 'vitest'
import {
  groupProjectCounts,
  groupProjectMonths,
  groupProjectSpending,
  groupProjectTokens,
  isClaudeAppScratchPath,
  matchesUsageProjectSearch
} from './usage-projects'
import { readProjectIdentity } from './project-identity'

describe('isClaudeAppScratchPath', () => {
  it.each([
    '/Users/sai/Library/Application Support/Claude/scratch-workspaces/0f38b541-eb93/aa1a892d-0651/scratch-2026-11-06-0f5802',
    '/Users/sai/Library/Application Support/Claude/scratch-workspaces/0f38b541/aa1a892d/scratch-2026-11-06-0f5802/',
    'C:\\Users\\Sai\\AppData\\Roaming\\Claude\\scratch-workspaces\\0f38b541\\aa1a892d\\scratch-2026-11-06-0f5802',
    'C:\\Users\\Sai\\AppData\\Local\\Packages\\Claude_pzs8sxrjxfjjc\\LocalCache\\Roaming\\Claude\\scratch-workspaces\\0f38b541\\aa1a892d\\scratch-2026-11-06-c3ed3c',
    'c:\\users\\sai\\appdata\\roaming\\claude\\Scratch-Workspaces\\a\\b\\scratch-2026-11-06-ABC123'
  ])('recognizes a Claude app chat folder: %s', (path) => {
    expect(isClaudeAppScratchPath(path)).toBe(true)
  })

  it.each([
    '/Users/sai/code/scratch-2026-11-06-0f5802',
    '/Users/sai/Library/Application Support/Claude/scratch-workspaces/0f38b541/scratch-2026-11-06-0f5802',
    '/Users/sai/Library/Application Support/Claude/scratch-workspaces/a/b/scratch-2026-11-06-0f5802/src',
    '/Users/sai/Library/Application Support/MyClaude/scratch-workspaces/a/b/scratch-2026-11-06-0f5802',
    '/Users/sai/Library/Application Support/Claude/scratch-workspaces/a/b/scratch-notes',
    '/Users/sai/Library/Application Support/Claude/scratch-workspaces/a/b/scratch-2026-11-06-xyz',
    ''
  ])('leaves other folders alone: %s', (path) => {
    expect(isClaudeAppScratchPath(path)).toBe(false)
  })
})

describe('grouping usage rows by Usage Project', () => {
  const identity = readProjectIdentity({
    locations: [
      { id: 'repo', path: '/repo', kind: 'repository', status: 'available' },
      { id: 'old', path: '/old', kind: 'repository', status: 'missing', linkedTo: 'repo' },
      { id: 'other', path: '/other', kind: 'repository', status: 'available' }
    ],
    claudeCodeFolders: []
  })

  it('adds up counts under the primary and sorts by size', () => {
    expect(
      groupProjectCounts(
        [
          { project: '/repo/a', count: 3 },
          { project: '/old/b', count: 5 },
          { project: '/other', count: 4 },
          { project: '/elsewhere', count: 9 }
        ],
        identity
      )
    ).toEqual([
      { project: '/elsewhere', count: 9 },
      { project: '/repo', count: 8 },
      { project: '/other', count: 4 }
    ])
  })

  it('combines every month and token category while keeping source rows unchanged', () => {
    const months = [
      { project: '/repo/a', total: 3, byMonth: [1, 2, ...Array(10).fill(0)] },
      { project: '/old/b', total: 7, byMonth: [3, 4, ...Array(10).fill(0)] }
    ]
    expect(groupProjectMonths(months, identity)).toEqual([
      { project: '/repo', total: 10, byMonth: [4, 6, ...Array(10).fill(0)] }
    ])
    expect(months[0].byMonth[0]).toBe(1)
    expect(
      groupProjectTokens(
        [
          {
            key: '/repo/a',
            tokens: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4, total: 10 }
          },
          { key: '/old/b', tokens: { input: 5, output: 6, cacheRead: 7, cacheWrite: 8, total: 26 } }
        ],
        identity
      )
    ).toEqual([
      { key: '/repo', tokens: { input: 6, output: 8, cacheRead: 10, cacheWrite: 12, total: 36 } }
    ])
  })

  it('combines cost shares without changing recorded spend', () => {
    expect(
      groupProjectSpending(
        [
          { project: '/repo/a', costUsd: 1.25 },
          { project: '/old/b', costUsd: 2.75 }
        ],
        identity
      )
    ).toEqual([{ project: '/repo', costUsd: 4 }])
  })
})

describe('matchesUsageProjectSearch', () => {
  it('finds retained Windows locations using an earlier disambiguated label or either separator', () => {
    expect(
      matchesUsageProjectSearch('Megatron HQ/Megatron', ['Megatron', 'C:\\Megatron HQ\\Megatron'])
    ).toBe(true)
    expect(matchesUsageProjectSearch(' c:/MEGATRON ', ['C:\\Megatron'])).toBe(true)
    expect(matchesUsageProjectSearch('Site', ['Megatron', 'C:\\Megatron HQ\\Megatron'])).toBe(false)
  })
})
