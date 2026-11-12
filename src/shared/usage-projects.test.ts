import { describe, expect, it } from 'vitest'
import { isClaudeAppScratchPath } from './usage-projects'

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
