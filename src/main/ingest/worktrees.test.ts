import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { grantPath, resetGrantedPaths } from '../permissions'
import { readProjectIdentity, type ProjectIdentity } from '../../shared/project-identity'
import type { WorktreeLink } from '../../shared/ipc'
import {
  chooseCanonical,
  coreBare,
  createPrunedWorktreeCheck,
  parseGitdir,
  readWorktreeIndex,
  commonDirOf
} from './worktrees'

const linkedBy = (links: WorktreeLink[]): ProjectIdentity =>
  readProjectIdentity({ locations: [], claudeCodeFolders: [] }, links)

describe('coreBare', () => {
  it.each([
    '[core]\n\tbare = true\n',
    '[core]\n\tbare = yes\n',
    '[core]\n\tbare = on\n',
    '[core]\n\tbare = 1\n',
    '[core]\n\tbare = 2\n',
    '[core]\n\tbare\n',
    '[core]\n\tbare # set by clone --bare\n',
    '[core]\n\tbare = true # set by clone --bare\n',
    '[core]\n\tbare = "true"\n',
    '[Core]\n\tBare = TRUE\n',
    '[core] bare = true\n',
    '[core]\r\n\tbare = true\r\n',
    '[core]\nbare=true',
    '[core]\n\tbare = false\n[core]\n\tbare = true\n'
  ])('reads %j as a bare repository', (config) => {
    expect(coreBare(config)).toBe(true)
  })

  it.each([
    '',
    '[core]\n\tbare = false\n',
    '[core]\n\tbare = no\n',
    '[core]\n\tbare = off\n',
    '[core]\n\tbare = 0\n',
    '[core]\n\tbare =\n',
    '[core]\n\tbare = false ; was true\n',
    '[core]\n\tbare = "yes ; not a comment"\n',
    '[core]\n\tbare = maybe\n',
    '[core]\n\t# bare = true\n',
    '[core]\n\tbareword = true\n',
    '[foo]\n\tbare = true\n',
    '[foo] bare = true\n',
    '[core "x"]\n\tbare = true\n',
    '[core]\n\tbare = false\n[foo]\n\tbare = true\n',
    '[core]\n\tbare = true\n[core]\n\tbare = false\n'
  ])('reads %j as a repository with a checkout', (config) => {
    expect(coreBare(config)).toBe(false)
  })
})

describe('parseGitdir', () => {
  it.each([
    ['gitdir: /code/app/.git/worktrees/x\n', '/code/wt', '/code/app/.git/worktrees/x'],
    ['gitdir: /code/app/.git/worktrees/x\r\n', '/code/wt', '/code/app/.git/worktrees/x'],
    ['/code/wt/.git\n', '/code/app/.git/worktrees/wt', '/code/wt/.git'],
    // Relative pointers resolve with the host's own path rules (a drive letter on Windows).
    ['gitdir: ../app/.git/worktrees/x\n', '/code/wt', resolve('/code/app/.git/worktrees/x')],
    ['../../../../wt/.git\n', '/code/app/.git/worktrees/wt', resolve('/code/wt/.git')],
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
    expect(parseGitdir(content, base, 'darwin')).toBe(expected)
  })

  it.each(['', '\n', 'gitdir:   \n'])('rejects an empty pointer %j', (content) => {
    expect(parseGitdir(content, '/code/wt')).toBeNull()
  })

  it('rejects a WSL pointer on Windows without rejecting UNC paths', () => {
    expect(parseGitdir('gitdir: /mnt/c/code/.git', 'C:\\wt', 'win32')).toBeNull()
    expect(parseGitdir('gitdir: //server/share/.git', 'C:\\wt', 'win32')).toBe(
      '//server/share/.git'
    )
  })
})

describe('ungranted commonDirOf', () => {
  it.each([
    ['/code/app/.git/worktrees/x', '/code/app/.git'],
    ['/code/app/.git/worktrees/x/', '/code/app/.git'],
    ['C:/code/app/.git/worktrees/x', 'C:/code/app/.git'],
    ['C:\\code\\app\\.git\\worktrees\\x', 'C:\\code\\app\\.git'],
    ['/code/app.git/worktrees/x', '/code/app.git'],
    ['/work/modules/app/.git/worktrees/x', '/work/modules/app/.git'],
    ['/work/modules/app.git/worktrees/x', '/work/modules/app.git']
  ])('finds the shared git dir of %s', (gitdir, expected) => {
    expect(commonDirOf(gitdir)).toBe(expected)
  })

  it.each([
    '/code/app/.git/modules/lib',
    '/code/app/.git/modules/lib/worktrees/x',
    '/code/app/.git/modules/libs/lib/worktrees/x',
    '/code/app/.git/modules/a/modules/b',
    '/elsewhere/app.git',
    'C:/outside-the-grant'
  ])('does not treat %s as a worktree', (gitdir) => {
    expect(commonDirOf(gitdir)).toBeNull()
  })
})

describe('chooseCanonical', () => {
  const bare = {
    complete: true,
    bare: true,
    head: 'main',
    worktree: null,
    worktrees: [
      { path: '/code/app/feature', branch: 'feature', missing: false },
      { path: '/code/app/main', branch: 'main', missing: false }
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

  it('has no Canonical Checkout for a bare repository without worktrees', () => {
    expect(chooseCanonical('/code/app.git', { ...bare, worktrees: [] })).toBeNull()
  })

  it('does not treat the bare container as a checkout', () => {
    expect(
      chooseCanonical('/code/app.git', { ...bare, worktrees: [] }, ['/code/wt'], '/code')
    ).toBeNull()
    expect(chooseCanonical('/code/app.git', bare, [], '/code')).toBe('/code/app/main')
  })

  it('ignores deleted worktrees when picking a canonical checkout', () => {
    const index = {
      ...bare,
      worktrees: [bare.worktrees[0], { ...bare.worktrees[1], missing: true }]
    }
    expect(chooseCanonical('/code/app.git', index)).toBe('/code/app/feature')
  })

  it('keeps a live saved canonical until a default-branch checkout appears', () => {
    const saved = '/code/app/main'
    expect(chooseCanonical('/code/app.git', { ...bare, head: 'trunk' }, [], undefined, saved)).toBe(
      saved
    )
    expect(chooseCanonical('/code/app.git', bare, [], undefined, '/code/app/feature')).toBe(saved)
  })

  it('uses core.worktree before the .git parent and refuses a guess for separate git dirs', () => {
    const index = { ...bare, bare: false, worktree: '/code/checkout' }
    expect(chooseCanonical('/code/holder/.git', index)).toBe('/code/checkout')
    expect(
      chooseCanonical('/code/store/app.git', { ...index, worktree: null }, ['/code/wt'])
    ).toBeNull()
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

  describe('granted commonDirOf', () => {
    it('reads commondir regardless of the administrative directory name', () => {
      const common = join(root, 'modules', 'app.git')
      const admin = join(common, 'worktrees', 'nested', 'id')
      mkdirSync(admin, { recursive: true })
      writeFileSync(join(admin, 'commondir'), '../../..')
      expect(commonDirOf(admin)).toBe(common)
    })

    it('rejects path-shaped candidates without a commondir and deleted admin directories', () => {
      const common = join(root, 'repo', '.git')
      const admin = join(common, 'worktrees', 'id')
      mkdirSync(admin, { recursive: true })
      expect(commonDirOf(admin)).toBeNull()
      expect(commonDirOf(join(common, 'worktrees', 'missing'))).toBeNull()
    })

    it('falls back to the admin path while the grant holding it is offline', () => {
      const volume = join(root, 'volume')
      resetGrantedPaths()
      grantPath(volume)
      expect(commonDirOf(join(volume, 'app', '.git', 'worktrees', 'wt'))).toBe(
        join(volume, 'app', '.git')
      )
    })

    it('keeps a submodule worktree independent even when the submodule name has slashes', () => {
      const admin = join(root, 'repo', '.git', 'modules', 'libs', 'foo', 'worktrees', 'id')
      mkdirSync(admin, { recursive: true })
      writeFileSync(join(admin, 'commondir'), '../..')
      expect(commonDirOf(admin)).toBeNull()
    })
  })

  describe('readWorktreeIndex', () => {
    // Captured from Git 2.54 repositories created with --ref-format=reftable.
    const mainHead =
      'UkVGVAEAEAAAAAAAAAAAAgAAAAAAAAACcgAAOAAjSEVBRAAPcmVmcy9oZWFkcy9tYWluAAAcAAFSRUZUAQAQAAAAAAAAAAACAAAAAAAAAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAH283XA=='
    const refsWithoutHead =
      'UkVGVAEAEAAAAAAAAAAAAQAAAAAAAAABcgAAYQBxcmVmcy9oZWFkcy9kZXYAsYREEKVxHqALP3OLxdjDWZrmLEsLIW1haW4AsYREEKVxHqALP3OLxdjDWZrmLEsAABwAAVJFRlQBABAAAAAAAAAAAAEAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAC2v/eK'
    const featureHead =
      'UkVGVAEAEAAAAAAAAAAAAQAAAAAAAAADcgAAWgAjSEVBRAAOcmVmcy9oZWFkcy9kZXYASU9SSUdfSEVBRAGxhEQQpXEeoAs/c4vF2MNZmuYsSwAAHAAAMgACZwAAdnjaY8j0cHV0YfgPAX82trgILC2UW8BtX9x99MbhyFnPdLyxiTHnJCYJA7FDakVibkFOql5mXlliTmZK67Uv88z+8YgVpRanllgp5OaXZealK5TkK4Bs4WJgYGFgBABApDBkUkVGVAEAEAAAAAAAAAAAAQAAAAAAAAADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAFoAAAAAAAAAAFqdG2E='
    const detachedSha256 =
      'UkVGVAIAEAAAAAAAAAAAAQAAAAAAAAADczI1NnIAAIEAIUhFQUQC7U5Y6GsToQWmrmD0LsYSNyXTi5IbUO8IS+JOlrdQsgIAeXJlZnMvaGVhZHMvbWFpbgHtTljoaxOhBaauYPQuxhI3JdOLkhtQ7whL4k6Wt1CyAgAAIAAARwACZwABuHjaY8j0cHV0YfgPAX/e+kW8yBZeyLpsXcIXvWNC5qqXuydJB7zn8H7kN217wCYmQvKiwYmZRZklGZnZCt75uaVFiWWpOTmVisUw0WyEoKGBgUN6bmJmjl5yfm7rtS+7zP/xMHLxcP5lIAAIuYHdLbOipLQoVSQNQjukViTmFuSk6pWkFpdALZIC2pmbWaKgkZmXWZKZmKNppQBlcTE0OBalphXrZ6QmphTrAx2YBwudAXcZAwsDoxgDEwCQKZ9WUkVGVAIAEAAAAAAAAAAAAQAAAAAAAAADczI1NgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACBAAAAAAAAAACvK/zY'

    function addReftables(gitdir: string, tables: string[]): void {
      const directory = join(gitdir, 'reftable')
      mkdirSync(directory, { recursive: true })
      const names = tables.map((encoded, i) => {
        const name = String(i) + '.ref'
        writeFileSync(join(directory, name), Buffer.from(encoded, 'base64'))
        return name
      })
      writeFileSync(join(directory, 'tables.list'), names.join('\n') + '\n')
    }

    it('reads HEAD from the reftable stacks of a bare repo and its linked worktree', () => {
      const common = join(root, 'app.git')
      const admin = join(common, 'worktrees', 'feature')
      addReftables(common, [featureHead, mainHead, refsWithoutHead])
      writeFileSync(join(common, 'config'), '[core]\n bare\n[extensions]\n refStorage = reftable\n')
      writeFileSync(join(common, 'HEAD'), 'ref: refs/heads/.invalid\n')
      addWorktreeEntry(common, 'feature', join(root, 'feature', '.git'), 'ref: refs/heads/.invalid')
      addReftables(admin, [featureHead])
      expect(readWorktreeIndex(common)).toMatchObject({
        head: 'main',
        worktrees: [{ branch: 'dev' }]
      })
    })

    it('does not revive an older branch after reftable HEAD is detached', () => {
      const common = join(root, 'app.git')
      addReftables(common, [mainHead, detachedSha256])
      writeFileSync(join(common, 'config'), '[extensions]\n refStorage = reftable\n')
      writeFileSync(join(common, 'HEAD'), 'ref: refs/heads/.invalid\n')
      expect(readWorktreeIndex(common)?.head).toBeNull()
    })

    it('does not treat malformed reftables as branches', () => {
      const common = join(root, 'app.git')
      addReftables(common, [mainHead, mainHead.slice(0, 45)])
      writeFileSync(join(common, 'config'), '[extensions]\n refStorage = reftable\n')
      writeFileSync(join(common, 'HEAD'), 'ref: refs/heads/.invalid\n')
      expect(readWorktreeIndex(common)?.head).toBeNull()
    })

    it('drops an entry whose live checkout points at another admin directory', () => {
      const common = join(root, 'copy', '.git')
      const checkout = join(root, 'wt')
      addWorktreeEntry(common, 'id', join(checkout, '.git'), 'ref: refs/heads/wt')
      addWorktreeEntry(join(root, 'original', '.git'), 'id', join(checkout, '.git'), 'ref: x')
      mkdirSync(checkout)
      writeFileSync(join(checkout, '.git'), 'gitdir: ../original/.git/worktrees/id\n')
      expect(readWorktreeIndex(common)?.worktrees).toEqual([])
    })

    it('keeps an entry whose checkout still names the admin dir of a renamed repository', () => {
      const common = join(root, 'moved', '.git')
      const checkout = join(root, 'wt')
      addWorktreeEntry(common, 'wt', join(checkout, '.git'), 'ref: refs/heads/wt')
      mkdirSync(checkout)
      writeFileSync(
        join(checkout, '.git'),
        `gitdir: ${join(root, 'app', '.git', 'worktrees', 'wt')}\n`
      )
      expect(readWorktreeIndex(common)?.worktrees).toEqual([
        { path: checkout, branch: 'wt', missing: false }
      ])
    })

    it('does not mark a worktree missing while the grant holding it is offline', () => {
      const common = join(root, 'repo', '.git')
      const volume = join(root, 'volume')
      addWorktreeEntry(common, 'wt', join(volume, 'wt', '.git'), 'ref: refs/heads/wt')
      resetGrantedPaths()
      grantPath(join(root, 'repo'))
      grantPath(volume)
      expect(readWorktreeIndex(common)?.worktrees).toEqual([
        { path: join(volume, 'wt'), branch: 'wt', missing: false }
      ])
    })

    it('marks a missing worktree unless it is locked', () => {
      const common = join(root, 'repo', '.git')
      for (const name of ['gone', 'locked']) {
        addWorktreeEntry(common, name, join(root, name, '.git'), 'ref: refs/heads/wt')
      }
      writeFileSync(join(common, 'worktrees', 'locked', 'locked'), '')
      expect(readWorktreeIndex(common)?.worktrees).toEqual([
        { path: join(root, 'gone'), branch: 'wt', missing: true },
        { path: join(root, 'locked'), branch: 'wt', missing: false }
      ])
    })

    it('reads a relative core.worktree with quoted spaces and inline comments', () => {
      const common = join(root, 'store', '.git')
      mkdirSync(common, { recursive: true })
      writeFileSync(
        join(common, 'config'),
        '[core]\n worktree = "../../with # spaces" # checkout\n'
      )
      expect(readWorktreeIndex(common)).toMatchObject({ worktree: join(root, 'with # spaces') })
    })

    it('overlays the enabled main-worktree config', () => {
      const common = join(root, 'app.git')
      mkdirSync(common)
      writeFileSync(
        join(common, 'config'),
        '[core]\n bare = false\n[extensions]\n worktreeConfig\n'
      )
      writeFileSync(join(common, 'config.worktree'), '[core]\n bare = true\n')
      expect(readWorktreeIndex(common)?.bare).toBe(true)
    })

    it('ignores the worktree config unless the extension is enabled', () => {
      const common = join(root, 'app.git')
      mkdirSync(common)
      writeFileSync(join(common, 'config'), '[core]\n bare = true\n')
      writeFileSync(join(common, 'config.worktree'), '[core]\n bare = false\n')
      expect(readWorktreeIndex(common)?.bare).toBe(true)
    })

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
        worktree: null,
        worktrees: [
          { path: join(root, 'wt-abs'), branch: 'feat', missing: true },
          { path: join(root, 'wt-det'), branch: null, missing: true },
          { path: join(root, 'wt-rel'), branch: 'feat2', missing: true }
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
        worktree: null,
        worktrees: []
      })
    })

    it('reads core.bare the way git does', () => {
      const common = join(root, 'app.git')
      mkdirSync(common)
      writeFileSync(join(common, 'config'), '[core]\n\tbare = yes\n')
      expect(readWorktreeIndex(common)?.bare).toBe(true)
    })

    it('skips an entry git itself would prune for a missing gitdir file', () => {
      const common = join(root, 'app', '.git')
      mkdirSync(join(common, 'worktrees', 'broken'), { recursive: true })
      addWorktreeEntry(common, 'ok', join(root, 'wt', '.git'), 'ref: refs/heads/x')

      expect(readWorktreeIndex(common)).toMatchObject({
        complete: true,
        worktrees: [{ path: join(root, 'wt'), branch: 'x', missing: true }]
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
      mkdirSync(join(root, 'live'))
    })

    it('reports a linked worktree its repository no longer lists', () => {
      const isPruned = createPrunedWorktreeCheck(
        linkedBy([{ path: join(root, 'gone'), canonical: app }])
      )
      expect(isPruned(join(root, 'gone'))).toBe(true)
    })

    it('keeps a worktree its repository still lists', () => {
      const isPruned = createPrunedWorktreeCheck(
        linkedBy([{ path: join(root, 'live'), canonical: app }])
      )
      expect(isPruned(join(root, 'live'))).toBe(false)
    })

    it('keeps a live worktree that was moved by hand and prunes the stale path', () => {
      const moved = join(root, 'moved')
      rmSync(join(root, 'live'), { recursive: true })
      mkdirSync(moved)
      const isPruned = createPrunedWorktreeCheck(
        linkedBy([
          { path: moved, canonical: app },
          { path: join(root, 'live'), canonical: app }
        ])
      )
      expect(isPruned(moved)).toBe(false)
      expect(isPruned(join(root, 'live'))).toBe(true)
    })

    it('follows a bare canonical checkout pointer before testing an ungranted path', () => {
      const common = join(root, 'app.git')
      const canonical = join(root, 'main')
      const gone = join(root, 'gone')
      addWorktreeEntry(common, 'main', join(canonical, '.git'), 'ref: refs/heads/main')
      const admin = join(common, 'worktrees', 'main')
      mkdirSync(canonical)
      writeFileSync(join(canonical, '.git'), 'gitdir: ../app.git/worktrees/main\n')
      writeFileSync(join(admin, 'commondir'), '../..\n')
      resetGrantedPaths()
      grantPath(common)
      grantPath(canonical)
      expect(createPrunedWorktreeCheck(linkedBy([{ path: gone, canonical }]))(gone)).toBe(true)
    })

    it('reports a pruned worktree in the Claude Code layout without a stored link', () => {
      expect(
        createPrunedWorktreeCheck(linkedBy([]))(join(app, '.claude', 'worktrees', 'old'))
      ).toBe(true)
    })

    it('never reports a path with no worktree link', () => {
      expect(createPrunedWorktreeCheck(linkedBy([]))(join(root, 'gone'))).toBe(false)
    })

    it('does not guess when the repository cannot be read', () => {
      resetGrantedPaths()
      const isPruned = createPrunedWorktreeCheck(
        linkedBy([{ path: join(root, 'gone'), canonical: app }])
      )
      expect(isPruned(join(root, 'gone'))).toBe(false)
    })

    it('does not guess when a granted worktree is gone but its repository cannot be read', () => {
      const worktrees = join(root, 'worktrees')
      mkdirSync(worktrees)
      resetGrantedPaths()
      grantPath(worktrees)
      const gone = join(worktrees, 'gone')
      expect(createPrunedWorktreeCheck(linkedBy([{ path: gone, canonical: app }]))(gone)).toBe(
        false
      )
    })

    it('does not prune a worktree while the grant holding it is offline', () => {
      const volume = join(root, 'volume')
      const wt = join(volume, 'wt')
      addWorktreeEntry(join(app, '.git'), 'wt', join(wt, '.git'), 'ref: refs/heads/wt')
      resetGrantedPaths()
      grantPath(app)
      grantPath(volume)
      expect(createPrunedWorktreeCheck(linkedBy([{ path: wt, canonical: app }]))(wt)).toBe(false)
    })

    it('does not guess when one of the repository worktree entries is unreadable', () => {
      mkdirSync(join(app, '.git', 'worktrees', 'odd', 'gitdir'), { recursive: true })
      resetGrantedPaths()
      grantPath(app)
      const isPruned = createPrunedWorktreeCheck(
        linkedBy([{ path: join(root, 'gone'), canonical: app }])
      )
      expect(isPruned(join(root, 'gone'))).toBe(false)
    })
  })
})
