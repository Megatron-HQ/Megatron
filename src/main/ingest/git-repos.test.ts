import { mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { basename, join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { grantPath, readAllowedDirectoryEntries, resetGrantedPaths } from '../permissions'
import { createProjectIdentity } from '../project-identity'
import type { ProjectIdentitySnapshot } from '../../shared/project-identity'
import type { WorktreeLink } from '../../shared/ipc'
import { createGitRepos, type FolderKind, type GitRepos } from './git-repos'

const empty: ProjectIdentitySnapshot = { locations: [], claudeCodeFolders: [] }
// Links an earlier Scan saved, recorded through main's owner as the app does.
function saved(links: WorktreeLink[]): ProjectIdentitySnapshot {
  const owner = createProjectIdentity({
    store: { read: () => [], write: () => undefined },
    claudeCodeFolders: [],
    sessionPaths: () => [],
    catalog: () => []
  })
  owner.recordScan({ worktrees: links, canonicalCheckouts: [] })
  return owner.snapshot()
}
const noneMissing = (): boolean => false

let root: string
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'megatron-git-repos-')))
  grantPath(root)
})
afterEach(() => {
  resetGrantedPaths()
  rmSync(root, { recursive: true, force: true })
})

// Discovery hands over the entries it already read.
function meet(repos: GitRepos, path: string, asCheckout = false): FolderKind {
  return repos.meet({ path, entries: readAllowedDirectoryEntries(path).entries, asCheckout })
}
// git's side of a worktree: its admin entry in the shared git dir.
function addWorktreeEntry(commonDir: string, name: string, gitdir: string, head: string): string {
  const entry = join(commonDir, 'worktrees', name)
  mkdirSync(entry, { recursive: true })
  writeFileSync(join(entry, 'gitdir'), `${gitdir}\n`)
  writeFileSync(join(entry, 'HEAD'), `${head}\n`)
  return entry
}
// Mirrors what `git worktree add` writes on both sides of the link.
function addWorktree(
  commonDir: string,
  worktree: string,
  head = 'ref: refs/heads/feature'
): string {
  const entry = addWorktreeEntry(commonDir, basename(worktree), join(worktree, '.git'), head)
  writeFileSync(join(entry, 'commondir'), '../..\n')
  mkdirSync(worktree, { recursive: true })
  writeFileSync(join(worktree, '.git'), `gitdir: ${entry}\n`)
  return entry
}
function initBare(commonDir: string, head = 'main'): void {
  mkdirSync(join(commonDir, 'objects'), { recursive: true })
  mkdirSync(join(commonDir, 'refs'))
  writeFileSync(join(commonDir, 'config'), '[core]\n\tbare = true\n')
  writeFileSync(join(commonDir, 'HEAD'), `ref: refs/heads/${head}\n`)
}
function pointAt(folder: string, gitdir: string): void {
  mkdirSync(folder, { recursive: true })
  writeFileSync(join(folder, '.git'), `gitdir: ${gitdir}\n`)
}
// Git for Windows writes drive-letter pointers; a bare `/…` pointer there is a WSL path the parser
// refuses, so an ungranted POSIX path stands for the same layout on C: under Windows.
function ungranted(path: string): string {
  return process.platform === 'win32' && path.startsWith('/') ? `C:${path}` : path
}

describe('meeting folders', () => {
  let app: string
  beforeEach(() => {
    app = join(root, 'app')
    mkdirSync(join(app, '.git'), { recursive: true })
  })

  it('reads a folder with a .git dir as a checkout', () => {
    expect(meet(createGitRepos(empty), app)).toBe('checkout')
  })

  it('holds back a linked worktree, unless discovery already chose to walk it', () => {
    const worktree = join(root, 'wt')
    addWorktree(join(app, '.git'), worktree)
    expect(meet(createGitRepos(empty), worktree)).toBe('worktree')
    expect(meet(createGitRepos(empty), worktree, true)).toBe('checkout')
  })

  it('holds back a checkout whose admin dir is gone as an orphan', () => {
    const worktree = join(root, 'wt')
    rmSync(addWorktree(join(app, '.git'), worktree), { recursive: true })
    expect(meet(createGitRepos(empty), worktree)).toBe('orphan')
  })

  it('reads a .git file naming an admin dir without commondir as a checkout', () => {
    const worktree = join(root, 'wt')
    const admin = join(root, 'repo', '.git', 'worktrees', 'id')
    mkdirSync(admin, { recursive: true })
    pointAt(worktree, admin)
    expect(meet(createGitRepos(empty), worktree)).toBe('checkout')
  })

  it('keeps submodules and their worktrees checkouts of their own', () => {
    const modules = join(app, '.git', 'modules')
    mkdirSync(join(modules, 'lib'), { recursive: true })
    pointAt(join(app, 'lib'), join(modules, 'lib'))
    // A submodule name with slashes still sits under modules/.
    const admin = join(modules, 'libs', 'foo', 'worktrees', 'id')
    mkdirSync(admin, { recursive: true })
    writeFileSync(join(admin, 'commondir'), '../..')
    pointAt(join(root, 'foo-wt'), admin)
    const repos = createGitRepos(empty)
    expect(meet(repos, join(app, 'lib'))).toBe('checkout')
    expect(meet(repos, join(root, 'foo-wt'))).toBe('checkout')
  })

  it('reads a worktree by its admin path while the grant holding its repository is offline', () => {
    const volume = join(root, 'volume')
    const worktree = join(root, 'wt')
    pointAt(worktree, join(volume, 'app', '.git', 'worktrees', 'wt'))
    resetGrantedPaths()
    grantPath(volume)
    grantPath(worktree)
    expect(meet(createGitRepos(empty), worktree)).toBe('worktree')
  })

  it.each([
    ['/code/app/.git/worktrees/x', 'worktree'],
    ['/code/app/.git/worktrees/x/', 'worktree'],
    ['C:/code/app/.git/worktrees/x', 'worktree'],
    ['C:\\code\\app\\.git\\worktrees\\x', 'worktree'],
    ['/code/app.git/worktrees/x', 'worktree'],
    ['/work/modules/app/.git/worktrees/x', 'worktree'],
    ['/work/modules/app.git/worktrees/x', 'worktree'],
    ['/code/app/.git/modules/lib', 'checkout'],
    ['/code/app/.git/modules/lib/worktrees/x', 'checkout'],
    ['/code/app/.git/modules/libs/lib/worktrees/x', 'checkout'],
    ['/code/app/.git/modules/a/modules/b', 'checkout'],
    ['/elsewhere/app.git', 'checkout'],
    ['C:/outside-the-grant', 'checkout']
  ])('reads a .git file naming ungranted %s as a %s', (gitdir, kind) => {
    const worktree = join(root, 'wt')
    pointAt(worktree, ungranted(gitdir))
    expect(meet(createGitRepos(empty), worktree)).toBe(kind)
  })

  it('reads a folder whose .git file names a bare repository as a bare container', () => {
    initBare(join(root, 'app.git'))
    pointAt(join(root, 'project'), join(root, 'app.git'))
    expect(meet(createGitRepos(empty), join(root, 'project'))).toBe('bare-container')
  })

  it.each([
    [
      '[core]\n bare = false\n[extensions]\n worktreeConfig\n',
      '[core]\n bare = true\n',
      'bare-container'
    ],
    ['[core]\n bare = true\n', '[core]\n bare = false\n', 'bare-container'],
    ['[core]\n bare = yes\n', '', 'bare-container'],
    ['[core]\n bare = false\n', '[core]\n bare = true\n', 'checkout']
  ])('reads config %j with config.worktree %j as a %s', (config, overlay, kind) => {
    const common = join(root, 'app.git')
    mkdirSync(common)
    writeFileSync(join(common, 'config'), config)
    writeFileSync(join(common, 'config.worktree'), overlay)
    pointAt(join(root, 'project'), common)
    expect(meet(createGitRepos(empty), join(root, 'project'))).toBe(kind)
  })

  it('reads a .git dir whose core.worktree names a checkout elsewhere as a git dir holder', () => {
    const holder = join(root, 'store')
    const checkout = join(root, 'with # spaces')
    mkdirSync(join(holder, '.git'), { recursive: true })
    mkdirSync(checkout)
    writeFileSync(
      join(holder, '.git', 'config'),
      '[core]\n worktree = "../../with # spaces" # checkout\n'
    )
    const repos = createGitRepos(empty)
    expect(meet(repos, holder)).toBe('git-dir-holder')
    expect(repos.resolve()).toMatchObject({ redirects: [checkout], gitDirHolders: [holder] })
  })

  it('reads a standalone git dir as plumbing', () => {
    const dotfiles = join(root, 'dotfiles')
    initBare(dotfiles)
    expect(meet(createGitRepos(empty), dotfiles)).toBe('git-dir')
  })

  it('reads a folder holding a bare .git dir as plain', () => {
    initBare(join(root, 'project', '.git'))
    expect(meet(createGitRepos(empty), join(root, 'project'))).toBe('plain')
  })
})

describe('claiming orphans', () => {
  it('gives an orphan to the renamed repository that still lists it', () => {
    const app = join(root, 'app')
    const moved = join(root, 'moved')
    const worktree = join(root, 'wt')
    mkdirSync(join(app, '.git'), { recursive: true })
    addWorktree(join(app, '.git'), worktree)
    renameSync(app, moved)
    const repos = createGitRepos(empty)

    expect(meet(repos, worktree)).toBe('orphan')
    expect(meet(repos, moved)).toBe('checkout')
    expect(repos.claimOrphan(worktree)).toBe(true)
    expect(repos.resolve().repos).toEqual([{ canonical: moved, worktrees: [worktree] }])
  })

  it('leaves an orphan no repository lists to discovery', () => {
    const app = join(root, 'app')
    const worktree = join(root, 'wt')
    mkdirSync(join(app, '.git'), { recursive: true })
    rmSync(addWorktree(join(app, '.git'), worktree), { recursive: true })
    const repos = createGitRepos(empty)
    meet(repos, worktree)
    meet(repos, app)

    expect(repos.claimOrphan(worktree)).toBe(false)
    expect(repos.resolve().repos).toEqual([])
  })
})

describe('Canonical Checkouts', () => {
  const canonicalOf = (...worktrees: string[]): (string | null)[] => {
    const repos = createGitRepos(empty)
    for (const worktree of worktrees) meet(repos, worktree)
    return repos.resolve().repos.map((repo) => repo.canonical)
  }

  it('uses the folder that holds a normal repository', () => {
    const app = join(root, 'app')
    mkdirSync(join(app, '.git'), { recursive: true })
    addWorktree(join(app, '.git'), join(root, 'wt'))
    expect(canonicalOf(join(root, 'wt'))).toEqual([app])
  })

  it('groups the worktrees of an unreadable repository under the folder holding its .git', () => {
    pointAt(join(root, 'a'), ungranted('/code/app/.git/worktrees/a'))
    pointAt(join(root, 'b'), ungranted('/code/app/.git/worktrees/b'))
    const repos = createGitRepos(empty)
    meet(repos, join(root, 'a'))
    meet(repos, join(root, 'b'))
    expect(repos.resolve().repos).toEqual([
      { canonical: ungranted('/code/app'), worktrees: [join(root, 'a'), join(root, 'b')] }
    ])
  })

  it('picks the first worktree by path when an unreadable bare repository lists none', () => {
    pointAt(join(root, 'wt-b'), ungranted('/code/app.git/worktrees/b'))
    pointAt(join(root, 'wt-a'), ungranted('/code/app.git/worktrees/a'))
    expect(canonicalOf(join(root, 'wt-b'), join(root, 'wt-a'))).toEqual([join(root, 'wt-a')])
  })

  it('uses the checkout whose .git file names a separate git dir', () => {
    const store = join(root, 'store', 'app.git')
    const separate = join(root, 'separate')
    mkdirSync(store, { recursive: true })
    pointAt(separate, store)
    addWorktree(store, join(root, 'wt'))
    const repos = createGitRepos(empty)
    expect(meet(repos, separate)).toBe('checkout')
    meet(repos, join(root, 'wt'))
    expect(repos.resolve().repos).toEqual([{ canonical: separate, worktrees: [join(root, 'wt')] }])
  })

  it('refuses a guess for a separate git dir whose checkout is unknown', () => {
    const store = join(root, 'store', 'app.git')
    mkdirSync(store, { recursive: true })
    addWorktree(store, join(root, 'wt'))
    expect(canonicalOf(join(root, 'wt'))).toEqual([null])
  })

  it('uses core.worktree before the folder holding the .git dir', () => {
    const holder = join(root, 'holder')
    const checkout = join(root, 'checkout')
    mkdirSync(join(holder, '.git'), { recursive: true })
    mkdirSync(checkout)
    writeFileSync(join(holder, '.git', 'config'), '[core]\n worktree = ../../checkout\n')
    addWorktree(join(holder, '.git'), join(root, 'wt'))
    expect(canonicalOf(join(root, 'wt'))).toEqual([checkout])
  })

  describe('of a bare repository', () => {
    let bare: string
    beforeEach(() => {
      bare = join(root, 'app.git')
      initBare(bare)
      addWorktree(bare, join(root, 'a-feature'), 'ref: refs/heads/feature')
      addWorktree(bare, join(root, 'z-main'), 'ref: refs/heads/main')
    })
    const both = (): (string | null)[] => canonicalOf(join(root, 'a-feature'), join(root, 'z-main'))

    it('uses the worktree on the default branch', () => {
      expect(both()).toEqual([join(root, 'z-main')])
    })

    it('falls back to the first worktree by path', () => {
      writeFileSync(join(bare, 'HEAD'), 'ref: refs/heads/trunk\n')
      expect(both()).toEqual([join(root, 'a-feature')])
    })

    it('skips a deleted default-branch worktree unless it is locked', () => {
      rmSync(join(root, 'z-main'), { recursive: true })
      expect(canonicalOf(join(root, 'a-feature'))).toEqual([join(root, 'a-feature')])
      writeFileSync(join(bare, 'worktrees', 'z-main', 'locked'), 'unmounted volume')
      expect(canonicalOf(join(root, 'a-feature'))).toEqual([join(root, 'z-main')])
    })

    it('keeps the saved canonical while it is live, until the default branch appears', () => {
      writeFileSync(join(bare, 'HEAD'), 'ref: refs/heads/trunk\n')
      const link = { path: join(root, 'a-feature'), canonical: join(root, 'z-main') }
      const resolved = (): (string | null)[] => {
        const repos = createGitRepos(saved([link]))
        meet(repos, join(root, 'a-feature'))
        meet(repos, join(root, 'z-main'))
        return repos.resolve().repos.map((repo) => repo.canonical)
      }
      expect(resolved()).toEqual([join(root, 'z-main')])
      writeFileSync(join(bare, 'HEAD'), 'ref: refs/heads/feature\n')
      expect(resolved()).toEqual([join(root, 'a-feature')])
    })

    it('does not count a worktree offline with its grant as deleted', () => {
      const volume = join(root, 'volume')
      addWorktreeEntry(bare, 'main', join(volume, 'main', '.git'), 'ref: refs/heads/main')
      rmSync(join(root, 'z-main'), { recursive: true })
      rmSync(join(bare, 'worktrees', 'z-main'), { recursive: true })
      resetGrantedPaths()
      grantPath(bare)
      grantPath(join(root, 'a-feature'))
      grantPath(volume)
      expect(canonicalOf(join(root, 'a-feature'))).toEqual([join(volume, 'main')])
    })
  })

  describe('of a reftable repository', () => {
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

    // `a` is on dev and `z` on main, read from their own stacks; HEAD files say nothing.
    it.each([
      ['an unbroken stack', [featureHead, mainHead, refsWithoutHead], 'z'],
      ['a stack whose HEAD was detached', [mainHead, detachedSha256], 'a'],
      ['a malformed stack', [mainHead, mainHead.slice(0, 45)], 'a']
    ])('reads the default branch from %s', (_, tables, expected) => {
      const bare = join(root, 'app.git')
      initBare(bare)
      writeFileSync(join(bare, 'config'), '[core]\n bare\n[extensions]\n refStorage = reftable\n')
      writeFileSync(join(bare, 'HEAD'), 'ref: refs/heads/.invalid\n')
      addReftables(bare, tables)
      addReftables(addWorktree(bare, join(root, 'a'), 'ref: refs/heads/.invalid'), [featureHead])
      addReftables(addWorktree(bare, join(root, 'z'), 'ref: refs/heads/.invalid'), [mainHead])
      expect(canonicalOf(join(root, 'a'), join(root, 'z'))).toEqual([join(root, expected)])
    })
  })
})

describe('repo findings', () => {
  let app: string
  beforeEach(() => {
    app = join(root, 'app')
    mkdirSync(join(app, '.git'), { recursive: true })
    writeFileSync(join(app, '.git', 'HEAD'), 'ref: refs/heads/main\n')
  })
  const findingsOf = (...folders: string[]): ReturnType<GitRepos['findings']> => {
    const repos = createGitRepos(empty)
    for (const folder of folders) meet(repos, folder)
    repos.resolve()
    return repos.findings()
  }

  it('links every worktree a repository lists, wherever it is', () => {
    const common = join(app, '.git')
    addWorktreeEntry(common, 'abs', join(root, 'wt-abs', '.git'), 'ref: refs/heads/feat')
    addWorktreeEntry(common, 'rel', '../../../../wt-rel/.git', 'ref: refs/heads/feat2')
    addWorktreeEntry(common, 'det', join(root, 'wt-det', '.git'), '21c0f813ac84cdea8918fb6')

    expect(findingsOf(app).worktrees).toEqual([
      { path: join(root, 'wt-abs'), canonical: app },
      { path: join(root, 'wt-det'), canonical: app },
      { path: join(root, 'wt-rel'), canonical: app }
    ])
  })

  it('does not link a worktree whose checkout names another admin dir', () => {
    const copy = join(root, 'copy')
    const worktree = join(root, 'wt')
    addWorktreeEntry(join(copy, '.git'), 'id', join(worktree, '.git'), 'ref: refs/heads/wt')
    addWorktreeEntry(join(root, 'original', '.git'), 'id', join(worktree, '.git'), 'ref: x')
    pointAt(worktree, '../original/.git/worktrees/id')
    expect(findingsOf(copy).worktrees).toEqual([])
  })

  it('links a worktree that still names the admin dir of its renamed repository', () => {
    const moved = join(root, 'moved')
    const worktree = join(root, 'wt')
    addWorktreeEntry(join(moved, '.git'), 'wt', join(worktree, '.git'), 'ref: refs/heads/wt')
    pointAt(worktree, join(root, 'gone', '.git', 'worktrees', 'wt'))
    expect(findingsOf(moved).worktrees).toEqual([{ path: worktree, canonical: moved }])
  })

  it('proves a fully read repository, skipping an entry git itself would prune', () => {
    mkdirSync(join(app, '.git', 'worktrees', 'broken'), { recursive: true })
    addWorktreeEntry(join(app, '.git'), 'ok', join(root, 'wt', '.git'), 'ref: refs/heads/x')
    const findings = findingsOf(app)
    expect(findings.worktrees).toEqual([{ path: join(root, 'wt'), canonical: app }])
    expect(findings.canonicalCheckouts).toEqual([expect.objectContaining({ path: app })])
  })

  it('does not prove a repository with an unreadable worktree entry', () => {
    mkdirSync(join(app, '.git', 'worktrees', 'odd', 'gitdir'), { recursive: true })
    expect(findingsOf(app).canonicalCheckouts).toEqual([])
  })

  it('links a bare container to its Canonical Checkout, and nothing without one', () => {
    const project = join(root, 'project')
    initBare(join(project, '.bare'))
    pointAt(project, './.bare')
    expect(findingsOf(project).worktrees).toEqual([])
    addWorktree(join(project, '.bare'), join(project, 'main'), 'ref: refs/heads/main')
    expect(findingsOf(project).worktrees).toEqual([
      { path: project, canonical: join(project, 'main') }
    ])
  })

  it('keeps what folders met after resolve() prove', () => {
    const project = join(root, 'project')
    initBare(join(project, '.bare'))
    pointAt(project, './.bare')
    addWorktree(join(project, '.bare'), join(project, 'main'), 'ref: refs/heads/main')
    const repos = createGitRepos(empty)
    meet(repos, app)
    repos.resolve()
    meet(repos, project)
    expect(repos.findings().worktrees).toEqual([
      { path: project, canonical: join(project, 'main') }
    ])
  })
})

describe('pruned worktrees', () => {
  let app: string
  beforeEach(() => {
    app = join(root, 'app')
    mkdirSync(join(app, '.git'), { recursive: true })
    addWorktreeEntry(join(app, '.git'), 'live', join(root, 'live', '.git'), 'ref: refs/heads/x')
    mkdirSync(join(root, 'live'))
  })
  const isPruned = (links: WorktreeLink[], path: string): boolean =>
    createGitRepos(saved(links)).isPrunedWorktree(path, noneMissing)

  it('reports a linked worktree its repository no longer lists', () => {
    expect(isPruned([{ path: join(root, 'gone'), canonical: app }], join(root, 'gone'))).toBe(true)
  })

  it('keeps a worktree its repository still lists', () => {
    expect(isPruned([{ path: join(root, 'live'), canonical: app }], join(root, 'live'))).toBe(false)
  })

  it('keeps a live worktree that was moved by hand and prunes the stale path', () => {
    const moved = join(root, 'moved')
    rmSync(join(root, 'live'), { recursive: true })
    mkdirSync(moved)
    const repos = createGitRepos(
      saved([
        { path: moved, canonical: app },
        { path: join(root, 'live'), canonical: app }
      ])
    )
    expect(repos.isPrunedWorktree(moved, noneMissing)).toBe(false)
    expect(repos.isPrunedWorktree(join(root, 'live'), noneMissing)).toBe(true)
  })

  it('follows a bare canonical checkout pointer before testing an ungranted path', () => {
    const common = join(root, 'app.git')
    const canonical = join(root, 'main')
    const gone = join(root, 'gone')
    const admin = addWorktreeEntry(common, 'main', join(canonical, '.git'), 'ref: refs/heads/main')
    writeFileSync(join(admin, 'commondir'), '../..\n')
    pointAt(canonical, '../app.git/worktrees/main')
    resetGrantedPaths()
    grantPath(common)
    grantPath(canonical)
    expect(isPruned([{ path: gone, canonical }], gone)).toBe(true)
  })

  it('reports a pruned worktree in the Claude Code layout without a stored link', () => {
    expect(isPruned([], join(app, '.claude', 'worktrees', 'old'))).toBe(true)
  })

  it('never reports a path with no worktree link', () => {
    expect(isPruned([], join(root, 'gone'))).toBe(false)
  })

  it('does not guess when the repository cannot be read', () => {
    resetGrantedPaths()
    expect(isPruned([{ path: join(root, 'gone'), canonical: app }], join(root, 'gone'))).toBe(false)
  })

  it('does not guess when a granted worktree is gone but its repository cannot be read', () => {
    const worktrees = join(root, 'worktrees')
    mkdirSync(worktrees)
    resetGrantedPaths()
    grantPath(worktrees)
    const gone = join(worktrees, 'gone')
    expect(isPruned([{ path: gone, canonical: app }], gone)).toBe(false)
  })

  it('does not prune a worktree while the grant holding it is offline', () => {
    const volume = join(root, 'volume')
    const wt = join(volume, 'wt')
    addWorktreeEntry(join(app, '.git'), 'wt', join(wt, '.git'), 'ref: refs/heads/wt')
    resetGrantedPaths()
    grantPath(app)
    grantPath(volume)
    expect(isPruned([{ path: wt, canonical: app }], wt)).toBe(false)
  })

  it('does not guess when one of the repository worktree entries is unreadable', () => {
    mkdirSync(join(app, '.git', 'worktrees', 'odd', 'gitdir'), { recursive: true })
    resetGrantedPaths()
    grantPath(app)
    expect(isPruned([{ path: join(root, 'gone'), canonical: app }], join(root, 'gone'))).toBe(false)
  })

  it('answers from what this Scan read, even after the git dir changes', () => {
    const repos = createGitRepos(saved([{ path: join(root, 'live'), canonical: app }]))
    meet(repos, app)
    rmSync(join(root, 'live'), { recursive: true })
    rmSync(join(app, '.git', 'worktrees', 'live'), { recursive: true })
    expect(repos.isPrunedWorktree(join(root, 'live'), noneMissing)).toBe(false)
  })

  it("prunes a deleted worktree known only from this Scan's findings", () => {
    addWorktreeEntry(join(app, '.git'), 'gone', join(root, 'gone', '.git'), 'ref: refs/heads/x')
    const repos = createGitRepos(empty)
    meet(repos, app)
    repos.resolve()
    repos.findings()
    expect(repos.isPrunedWorktree(join(root, 'gone'), noneMissing)).toBe(true)
  })

  it('falls back to the caller for a folder with no worktree link', () => {
    expect(createGitRepos(empty).isPrunedWorktree(join(root, 'gone'), () => true)).toBe(true)
  })
})
