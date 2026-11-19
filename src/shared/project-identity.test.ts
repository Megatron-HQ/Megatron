import { describe, expect, it } from 'vitest'
import { readProjectIdentity } from './project-identity'
import type { UsageProjectLocation } from './usage-projects'

const empty = { locations: [], claudeCodeFolders: [] }
const location = (
  id: string,
  path: string,
  extra: Partial<UsageProjectLocation> = {}
): UsageProjectLocation => ({ id, path, kind: 'repository', status: 'available', ...extra })
const worktree = (id: string, path: string, linkedTo: string): UsageProjectLocation =>
  location(id, path, { linkedTo, worktree: true, worktreeEvidence: 'git' })

describe('checkoutOf', () => {
  describe("Claude Code's own worktree layout", () => {
    const app = '/Users/sai/code/app'
    const fix = `${app}/.claude/worktrees/fix-login`

    it.each([
      [fix, { worktree: fix, canonical: app, path: app }],
      [`${fix}/packages/web`, { worktree: fix, canonical: app, path: `${app}/packages/web` }],
      [`${fix}/`, { worktree: fix, canonical: app, path: app }],
      [
        'C:\\Users\\Sai\\code\\app\\.claude\\worktrees\\fix-login\\src',
        {
          worktree: 'C:\\Users\\Sai\\code\\app\\.claude\\worktrees\\fix-login',
          canonical: 'C:\\Users\\Sai\\code\\app',
          path: 'C:\\Users\\Sai\\code\\app/src'
        }
      ]
    ])('finds the Worktree and its Canonical Checkout in %s', (path, expected) => {
      expect(readProjectIdentity(empty).checkoutOf(path)).toEqual(expected)
    })

    it.each([
      '/Users/sai/code/app/.claude/worktrees',
      '/Users/sai/code/app/.claude/worktrees/',
      '/Users/sai/code/app/.claude/skills/review',
      '/Users/sai/code/app/.claudex/worktrees/fix-login',
      '/Users/sai/code/app/claude/worktrees/fix-login',
      '/.claude/worktrees/fix-login',
      '/Users/sai/code/app/.git/.claude/worktrees/fix-login',
      '/Users/sai/code/app',
      ''
    ])('leaves %s alone', (path) => {
      expect(readProjectIdentity(empty).checkoutOf(path)).toBeNull()
    })

    it('excludes the Claude Code Folders it was given, in any spelling', () => {
      const identity = readProjectIdentity({
        locations: [],
        claudeCodeFolders: ['/home/user/.claude', 'C:\\Profiles\\Work\\.claude']
      })
      expect(identity.checkoutOf('/home/user/.claude/worktrees/hook/src')).toBeNull()
      expect(identity.checkoutOf('c:/profiles/work/.claude/worktrees/hook/src')).toBeNull()
      expect(identity.checkoutOf('/home/user/code/app/.claude/worktrees/hook')?.canonical).toBe(
        '/home/user/code/app'
      )
    })
  })

  describe("this Scan's links", () => {
    const identity = readProjectIdentity(empty, [
      { path: '/Users/sai/orca/workspaces/app/ruffe', canonical: '/Users/sai/code/app' },
      { path: '/Users/sai/orca/workspaces/app', canonical: '/Users/sai/code/other' },
      { path: 'C:\\wt\\App-X', canonical: 'C:\\code\\app' }
    ])
    const pathOf = (path: string): string => identity.checkoutOf(path)?.path ?? path

    it('swaps a Worktree for its Canonical Checkout and keeps the subpath', () => {
      expect(identity.checkoutOf('/Users/sai/orca/workspaces/app/ruffe/packages/web')).toEqual({
        worktree: '/Users/sai/orca/workspaces/app/ruffe',
        canonical: '/Users/sai/code/app',
        path: '/Users/sai/code/app/packages/web'
      })
      expect(pathOf('/Users/sai/orca/workspaces/app/ruffe')).toBe('/Users/sai/code/app')
    })

    it('prefers the deepest matching Worktree', () => {
      expect(pathOf('/Users/sai/orca/workspaces/app/ruffe/src')).toBe('/Users/sai/code/app/src')
      expect(pathOf('/Users/sai/orca/workspaces/app/other/src')).toBe(
        '/Users/sai/code/other/other/src'
      )
    })

    it('does not treat a sibling with a shared name prefix as the Worktree', () => {
      expect(pathOf('/Users/sai/orca/workspaces/app/ruffe-2')).toBe('/Users/sai/code/other/ruffe-2')
      expect(identity.checkoutOf('/Users/sai/orca/workspaces/apple')).toBeNull()
    })

    it('matches Windows Worktrees regardless of case and separator', () => {
      expect(pathOf('c:/WT/app-x/src')).toBe('C:\\code\\app/src')
    })

    it('leaves a path outside every Worktree alone', () => {
      expect(identity.checkoutOf('/Users/sai/code/app/src')).toBeNull()
    })

    it('keeps paths inside a bare container’s Canonical Checkout unchanged', () => {
      const container = readProjectIdentity(empty, [
        { path: '/code/app', canonical: '/code/app/main' }
      ])
      expect(container.checkoutOf('/code/app')?.path).toBe('/code/app/main')
      expect(container.checkoutOf('/code/app/main/src')).toBeNull()
    })

    it('takes precedence over a saved link for the same Worktree', () => {
      const identity = readProjectIdentity(
        {
          locations: [location('a', '/code/a'), worktree('wt', '/wt/x', 'a')],
          claudeCodeFolders: []
        },
        [{ path: '/wt/x', canonical: '/code/b' }]
      )
      expect(identity.checkoutOf('/wt/x/src')?.path).toBe('/code/b/src')
    })
  })

  describe('saved Project Links', () => {
    it('follows a proven link to its Canonical Checkout', () => {
      const identity = readProjectIdentity({
        locations: [location('app', '/code/app'), worktree('wt', '/wt/app-x', 'app')],
        claudeCodeFolders: []
      })
      expect(identity.checkoutOf('/wt/app-x/packages/web')?.path).toBe('/code/app/packages/web')
    })

    it('follows a former Canonical Checkout to the current one', () => {
      const identity = readProjectIdentity({
        locations: [
          location('a', '/code/a'),
          worktree('b', '/code/b', 'a'),
          worktree('old', '/code/old', 'b')
        ],
        claudeCodeFolders: []
      })
      expect(identity.checkoutOf('/code/old/src')).toEqual({
        worktree: '/code/old',
        canonical: '/code/a',
        path: '/code/a/src'
      })
    })

    it('never follows a manual link', () => {
      const identity = readProjectIdentity({
        locations: [
          location('current', '/current/repo'),
          location('old', '/old/repo', { linkedTo: 'current' })
        ],
        claudeCodeFolders: []
      })
      expect(identity.checkoutOf('/old/repo/src')).toBeNull()
    })

    it('ignores a link into Git metadata', () => {
      const identity = readProjectIdentity({
        locations: [
          location('ghost', '/code/app/.git/modules'),
          worktree('wt', '/wt/legacy', 'ghost')
        ],
        claudeCodeFolders: []
      })
      expect(identity.checkoutOf('/wt/legacy')).toBeNull()
    })

    it('ignores a link the excluded home layout implied, unless Git proved it', () => {
      const path = '/home/user/.claude/worktrees/hook'
      const inferred = location('wt', path, { linkedTo: 'home', worktree: true })
      const snapshot = (
        entry: UsageProjectLocation
      ): Parameters<typeof readProjectIdentity>[0] => ({
        locations: [location('home', '/home/user'), entry],
        claudeCodeFolders: ['/home/user/.claude']
      })
      expect(readProjectIdentity(snapshot(inferred)).checkoutOf(path)).toBeNull()
      expect(
        readProjectIdentity(snapshot({ ...inferred, worktreeEvidence: 'git' })).checkoutOf(path)
          ?.canonical
      ).toBe('/home/user')
    })

    it('survives a cycle in a hand-edited list', () => {
      const identity = readProjectIdentity({
        locations: [worktree('a', '/code/a', 'b'), worktree('b', '/code/b', 'a')],
        claudeCodeFolders: []
      })
      expect(identity.checkoutOf('/code/a')?.canonical).toMatch(/^\/code\/[ab]$/)
    })
  })
})

describe('usageProjectOf', () => {
  it('gives a subfolder to the deepest Repo, in any Windows spelling', () => {
    const identity = readProjectIdentity({
      locations: [location('hq', 'C:\\HQ\\Megatron'), location('child', 'C:\\HQ\\Megatron\\Child')],
      claudeCodeFolders: []
    })
    expect(identity.usageProjectOf('c:/hq/megatron/src/')?.id).toBe('hq')
    expect(identity.usageProjectOf('C:\\HQ\\Megatron\\Child\\src')?.id).toBe('child')
  })

  it('follows every link up to the primary, manual ones included', () => {
    const identity = readProjectIdentity({
      locations: [
        location('external', '/external'),
        location('app', '/code/app', { linkedTo: 'external' }),
        worktree('wt', '/wt/app-x', 'app')
      ],
      claudeCodeFolders: []
    })
    expect(identity.usageProjectOf('/wt/app-x/src')?.path).toBe('/external')
    expect(identity.usageProjectOf('/code/app')?.path).toBe('/external')
  })

  it('lets a linked folder own what is under it, but not an inferred one', () => {
    const identity = readProjectIdentity({
      locations: [
        location('current', '/current/repo'),
        location('old', '/previous/repo', { kind: 'folder', linkedTo: 'current' }),
        location('src', '/current/repo/src', {
          kind: 'folder',
          linkedTo: 'current',
          inferredOwner: true
        }),
        location('loose', '/loose', { kind: 'folder' })
      ],
      claudeCodeFolders: []
    })
    expect(identity.usageProjectOf('/previous/repo/src')?.path).toBe('/current/repo')
    expect(identity.usageProjectOf('/previous/repository')).toBeUndefined()
    expect(identity.usageProjectOf('/loose')?.path).toBe('/loose')
    expect(identity.usageProjectOf('/loose/deeper')).toBeUndefined()
  })

  it('keeps POSIX case and directory boundaries', () => {
    const identity = readProjectIdentity({
      locations: [location('upper', '/work/Repo'), location('lower', '/work/repo')],
      claudeCodeFolders: []
    })
    expect(identity.usageProjectOf('/work/Repo/src')?.id).toBe('upper')
    expect(identity.usageProjectOf('/work/repo/src')?.id).toBe('lower')
    expect(identity.usageProjectOf('/work/repository')).toBeUndefined()
  })

  it('never gives an unknown working directory to a filesystem root', () => {
    const identity = readProjectIdentity({
      locations: [location('root', '/')],
      claudeCodeFolders: []
    })
    expect(identity.usageProjectOf('')).toBeUndefined()
    expect(identity.usageProjectOf('/anything')?.id).toBe('root')
  })

  it('stops at a link cycle instead of looping', () => {
    const identity = readProjectIdentity({
      locations: [location('a', '/a', { linkedTo: 'b' }), location('b', '/b', { linkedTo: 'a' })],
      claudeCodeFolders: []
    })
    expect(identity.usageProjectOf('/a')?.id).toBe('a')
  })
})
