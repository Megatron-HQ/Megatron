import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { grantPath, resetGrantedPaths } from '../permissions'
import {
  chooseCanonical,
  createPrunedWorktreeCheck,
  parseGitdir,
  readWorktreeIndex,
  worktreeCommonDir
} from './worktrees'

describe('parseGitdir', () => {
  it.each([
    ['gitdir: /code/app/.git/worktrees/x\n', '/code/wt', '/code/app/.git/worktrees/x'],
    ['gitdir: /code/app/.git/worktrees/x\r\n', '/code/wt', '/code/app/.git/worktrees/x'],
    ['/code/wt/.git\n', '/code/app/.git/worktrees/wt', '/code/wt/.git'],
    ['gitdir: ../app/.git/worktrees/x\n', '/code/wt', '/code/app/.git/worktrees/x'],
    ['../../../../wt/.git\n', '/code/app/.git/worktrees/wt', '/code/wt/.git'],
    [
      'gitdir: C:/Users/sai/app/.git/worktrees/x\n',
      '/code/wt',
      'C:/Users/sai/app/.git/worktrees/x'
    ],
    [
      'gitdir: //server/share/app/.git/worktrees/x',
      '/code/wt',
      '//server/share/app/.git/worktrees/x'
    ]
  ])('reads %j relative to %s', (content, base, expected) => {
    expect(parseGitdir(content, base)).toBe(expected)
  })

  it.each(['', '\n', 'gitdir:   \n'])('rejects an empty pointer %j', (content) => {
    expect(parseGitdir(content, '/code/wt')).toBeNull()
  })
})

describe('worktreeCommonDir', () => {
  it.each([
    ['/code/app/.git/worktrees/x', '/code/app/.git'],
    ['/code/app/.git/worktrees/x/', '/code/app/.git'],
    ['C:/code/app/.git/worktrees/x', 'C:/code/app/.git'],
    ['C:\\code\\app\\.git\\worktrees\\x', 'C:\\code\\app\\.git'],
    ['/code/app.git/worktrees/x', '/code/app.git'],
    ['/work/modules/app/.git/worktrees/x', '/work/modules/app/.git']
  ])('finds the shared git dir of %s', (gitdir, expected) => {
    expect(worktreeCommonDir(gitdir)).toBe(expected)
  })

  it.each([
    '/code/app/.git/modules/lib',
    '/code/app/.git/modules/lib/worktrees/x',
    '/code/app/.git/modules/a/modules/b',
    '/elsewhere/app.git',
    'C:/outside-the-grant'
  ])('does not treat %s as a worktree', (gitdir) => {
    expect(worktreeCommonDir(gitdir)).toBeNull()
  })
})

describe('chooseCanonical', () => {
  const bare = {
    complete: true,
    bare: true,
    head: 'main',
    worktrees: [
      { path: '/code/app/feature', branch: 'feature' },
      { path: '/code/app/main', branch: 'main' }
    ]
  }

  it('uses the folder that holds a normal repository', () => {
    expect(chooseCanonical('/code/app/.git', { ...bare, bare: false })).toBe('/code/app')
  })

  it('assumes a .git folder it cannot read belongs to a normal repository', () => {
    expect(chooseCanonical('/code/app/.git', null, ['/code/app-wt'])).toBe('/code/app')
  })

  it('uses the checkout that points its .git file at a separate git dir', () => {
    expect(chooseCanonical('/elsewhere/app.git', null, ['/code/app-wt'], '/code/app')).toBe(
      '/code/app'
    )
  })

  it('uses the bare repository worktree on its default branch', () => {
    expect(chooseCanonical('/code/app/.bare', bare)).toBe('/code/app/main')
  })

  it('falls back to the first bare repository worktree by path', () => {
    expect(chooseCanonical('/code/app/.bare', { ...bare, head: 'trunk' })).toBe('/code/app/feature')
  })

  it('picks the first known worktree when the bare repository is unreadable', () => {
    expect(chooseCanonical('/code/app.git', null, ['/code/wt-b', '/code/wt-a'])).toBe('/code/wt-a')
  })
})

describe('git worktree reads', () => {
  let root: string
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'megatron-worktrees-')))
    grantPath(root)
  })
  afterEach(() => {
    resetGrantedPaths()
    rmSync(root, { recursive: true, force: true })
  })

  function addWorktreeEntry(commonDir: string, name: string, gitdir: string, head: string): void {
    const entry = join(commonDir, 'worktrees', name)
    mkdirSync(entry, { recursive: true })
    writeFileSync(join(entry, 'gitdir'), `${gitdir}\n`)
    writeFileSync(join(entry, 'HEAD'), `${head}\n`)
  }

  describe('readWorktreeIndex', () => {
    it('lists every worktree with its branch', () => {
      const common = join(root, 'app', '.git')
      mkdirSync(common, { recursive: true })
      writeFileSync(join(common, 'config'), '[core]\n\tbare = false\n')
      writeFileSync(join(common, 'HEAD'), 'ref: refs/heads/main\n')
      addWorktreeEntry(common, 'abs', join(root, 'wt-abs', '.git'), 'ref: refs/heads/feat')
      addWorktreeEntry(common, 'rel', '../../../../wt-rel/.git', 'ref: refs/heads/feat2')
      addWorktreeEntry(common, 'det', join(root, 'wt-det', '.git'), '21c0f813ac84cdea8918fb6')

      expect(readWorktreeIndex(common)).toEqual({
        complete: true,
        bare: false,
        head: 'main',
        worktrees: [
          { path: join(root, 'wt-abs'), branch: 'feat' },
          { path: join(root, 'wt-det'), branch: null },
          { path: join(root, 'wt-rel'), branch: 'feat2' }
        ]
      })
    })

    it('recognizes a bare repository', () => {
      const common = join(root, 'app.git')
      mkdirSync(common)
      writeFileSync(
        join(common, 'config'),
        '[core]\n\trepositoryformatversion = 0\n\tbare = true\n'
      )
      writeFileSync(join(common, 'HEAD'), 'ref: refs/heads/trunk\n')

      expect(readWorktreeIndex(common)).toEqual({
        complete: true,
        bare: true,
        head: 'trunk',
        worktrees: []
      })
    })

    it('skips an entry git itself would prune for a missing gitdir file', () => {
      const common = join(root, 'app', '.git')
      mkdirSync(join(common, 'worktrees', 'broken'), { recursive: true })
      addWorktreeEntry(common, 'ok', join(root, 'wt', '.git'), 'ref: refs/heads/x')

      expect(readWorktreeIndex(common)).toMatchObject({
        complete: true,
        worktrees: [{ path: join(root, 'wt'), branch: 'x' }]
      })
    })

    it('reads nothing from an ungranted repository', () => {
      mkdirSync(join(root, 'app', '.git'), { recursive: true })
      resetGrantedPaths()
      expect(readWorktreeIndex(join(root, 'app', '.git'))).toBeNull()
    })

    it('reads nothing from a .git file', () => {
      mkdirSync(join(root, 'wt'))
      writeFileSync(join(root, 'wt', '.git'), 'gitdir: /code/app/.git/worktrees/wt\n')
      expect(readWorktreeIndex(join(root, 'wt', '.git'))).toBeNull()
    })
  })

  describe('createPrunedWorktreeCheck', () => {
    let app: string
    beforeEach(() => {
      app = join(root, 'app')
      mkdirSync(join(app, '.git'), { recursive: true })
      addWorktreeEntry(join(app, '.git'), 'live', join(root, 'live', '.git'), 'ref: refs/heads/x')
    })

    it('reports a linked worktree its repository no longer lists', () => {
      const isPruned = createPrunedWorktreeCheck([{ path: join(root, 'gone'), canonical: app }])
      expect(isPruned(join(root, 'gone'))).toBe(true)
    })

    it('keeps a worktree its repository still lists', () => {
      const isPruned = createPrunedWorktreeCheck([{ path: join(root, 'live'), canonical: app }])
      expect(isPruned(join(root, 'live'))).toBe(false)
    })

    it('reports a pruned worktree in the Claude Code layout without a stored link', () => {
      expect(createPrunedWorktreeCheck([])(join(app, '.claude', 'worktrees', 'old'))).toBe(true)
    })

    it('never reports a path with no worktree link', () => {
      expect(createPrunedWorktreeCheck([])(join(root, 'gone'))).toBe(false)
    })

    it('does not guess when the repository cannot be read', () => {
      resetGrantedPaths()
      grantPath(join(root, 'gone'))
      const isPruned = createPrunedWorktreeCheck([{ path: join(root, 'gone'), canonical: app }])
      expect(isPruned(join(root, 'gone'))).toBe(false)
    })

    it('does not guess when one of the repository worktree entries is unreadable', () => {
      mkdirSync(join(app, '.git', 'worktrees', 'odd', 'gitdir'), { recursive: true })
      const isPruned = createPrunedWorktreeCheck([{ path: join(root, 'gone'), canonical: app }])
      expect(isPruned(join(root, 'gone'))).toBe(false)
    })
  })
})
