import { afterEach, describe, expect, it } from 'vitest'
import { canonicalProjectPath, nativeWorktreeRoot, setClaudeCodeFolders } from './project-path'

afterEach(() => setClaudeCodeFolders([]))

describe('nativeWorktreeRoot', () => {
  it.each([
    [
      '/Users/sai/code/app/.claude/worktrees/fix-login',
      { path: '/Users/sai/code/app/.claude/worktrees/fix-login', canonical: '/Users/sai/code/app' }
    ],
    [
      '/Users/sai/code/app/.claude/worktrees/fix-login/packages/web',
      { path: '/Users/sai/code/app/.claude/worktrees/fix-login', canonical: '/Users/sai/code/app' }
    ],
    [
      '/Users/sai/code/app/.claude/worktrees/fix-login/',
      { path: '/Users/sai/code/app/.claude/worktrees/fix-login', canonical: '/Users/sai/code/app' }
    ],
    [
      'C:\\Users\\Sai\\code\\app\\.claude\\worktrees\\fix-login\\src',
      {
        path: 'C:\\Users\\Sai\\code\\app\\.claude\\worktrees\\fix-login',
        canonical: 'C:\\Users\\Sai\\code\\app'
      }
    ]
  ])('finds the worktree and its repo in %s', (path, expected) => {
    expect(nativeWorktreeRoot(path)).toEqual(expected)
  })

  it.each([
    '/Users/sai/code/app/.claude/worktrees',
    '/Users/sai/code/app/.claude/worktrees/',
    '/Users/sai/code/app/.claude/skills/review',
    '/Users/sai/code/app/.claudex/worktrees/fix-login',
    '/Users/sai/code/app/claude/worktrees/fix-login',
    '/.claude/worktrees/fix-login',
    '/Users/sai/code/app',
    ''
  ])('leaves %s alone', (path) => {
    expect(nativeWorktreeRoot(path)).toBeNull()
  })

  it('excludes both the active Claude Code Folder and the default home layout', () => {
    setClaudeCodeFolders(['/home/user/.claude', 'C:\\Profiles\\Work\\.claude'])
    expect(nativeWorktreeRoot('/home/user/.claude/worktrees/hook/src')).toBeNull()
    expect(nativeWorktreeRoot('c:/profiles/work/.claude/worktrees/hook/src')).toBeNull()
    expect(nativeWorktreeRoot('/home/user/code/app/.claude/worktrees/hook')?.canonical).toBe(
      '/home/user/code/app'
    )
  })
})

describe('canonicalProjectPath', () => {
  const links = [
    { path: '/Users/sai/orca/workspaces/app/ruffe', canonical: '/Users/sai/code/app' },
    { path: '/Users/sai/orca/workspaces/app', canonical: '/Users/sai/code/other' },
    { path: 'C:\\wt\\App-X', canonical: 'C:\\code\\app' }
  ]

  it('swaps a worktree for its canonical checkout and keeps the subpath', () => {
    expect(canonicalProjectPath('/Users/sai/orca/workspaces/app/ruffe/packages/web', links)).toBe(
      '/Users/sai/code/app/packages/web'
    )
  })

  it('maps the worktree root itself to the canonical checkout', () => {
    expect(canonicalProjectPath('/Users/sai/orca/workspaces/app/ruffe', links)).toBe(
      '/Users/sai/code/app'
    )
  })

  it('prefers the longest matching worktree', () => {
    expect(canonicalProjectPath('/Users/sai/orca/workspaces/app/ruffe/src', links)).toBe(
      '/Users/sai/code/app/src'
    )
    expect(canonicalProjectPath('/Users/sai/orca/workspaces/app/other/src', links)).toBe(
      '/Users/sai/code/other/other/src'
    )
  })

  it('does not treat a sibling with a shared name prefix as the worktree', () => {
    expect(canonicalProjectPath('/Users/sai/orca/workspaces/app/ruffe-2', links)).toBe(
      '/Users/sai/code/other/ruffe-2'
    )
    expect(canonicalProjectPath('/Users/sai/orca/workspaces/apple', links)).toBe(
      '/Users/sai/orca/workspaces/apple'
    )
  })

  it('matches Windows worktrees regardless of case and separator', () => {
    expect(canonicalProjectPath('c:/WT/app-x/src', links)).toBe('C:\\code\\app/src')
  })

  it('falls back to the Claude Code worktree layout without a stored link', () => {
    expect(canonicalProjectPath('/Users/sai/code/app/.claude/worktrees/fix/src', [])).toBe(
      '/Users/sai/code/app/src'
    )
  })

  it('leaves a path outside every worktree unchanged', () => {
    expect(canonicalProjectPath('/Users/sai/code/app/src', links)).toBe('/Users/sai/code/app/src')
  })

  it('keeps paths inside a bare container’s canonical checkout unchanged', () => {
    const container = [{ path: '/code/app', canonical: '/code/app/main' }]
    expect(canonicalProjectPath('/code/app', container)).toBe('/code/app/main')
    expect(canonicalProjectPath('/code/app/main/src', container)).toBe('/code/app/main/src')
  })
})
