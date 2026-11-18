import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as permissions from '../permissions'
import { grantPath, resetGrantedPaths, revokePath } from '../permissions'
import { createMissingProjectCheck, discoverProjects } from './project-discovery'
import type { ProjectFolder } from '../../shared/ipc'
import Database from 'better-sqlite3'
import { applySchema } from '../db/schema'
import { listSkills, setWorktreeLinkSource } from '../db/queries'
import { applyWorktreeEvidence, reconcileUsageProjects, worktreeLinks } from '../usage-projects'
import { scanSkills } from './skills-scanner'

// Git config values treat a backslash as an escape, so tests write paths the way git does.
const gitPath = (path: string): string => path.replace(/\\/g, '/')
const caseInsensitive = existsSync(tmpdir().toUpperCase()) && existsSync(tmpdir().toLowerCase())

let root: string
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'megatron-project-discovery-')))
  grantPath(root)
})
afterEach(() => {
  vi.restoreAllMocks()
  resetGrantedPaths()
  rmSync(root, { recursive: true, force: true })
})

describe('missing project paths through aliases', () => {
  let workspace: string
  let selected: string
  beforeEach(() => {
    workspace = join(root, 'workspace')
    selected = join(root, 'selected')
    mkdirSync(workspace)
    symlinkSync(workspace, selected, process.platform === 'win32' ? 'junction' : 'dir')
    resetGrantedPaths()
    grantPath(selected)
  })

  it('recognizes deleted descendants recorded through the selected alias', () => {
    const repository = join(selected, 'packages', 'removed')
    mkdirSync(repository, { recursive: true })
    const isMissing = createMissingProjectCheck()
    expect(isMissing(repository)).toBe(false)
    rmSync(join(workspace, 'packages'), { recursive: true })

    expect(isMissing(repository)).toBe(true)
  })

  it('retains explicitly granted missing children recorded through an alias', () => {
    const repository = join(selected, 'direct')
    mkdirSync(repository)
    grantPath(repository)
    rmSync(join(workspace, 'direct'), { recursive: true })

    expect(createMissingProjectCheck()(repository)).toBe(false)
  })

  it('keeps excluded descendants outside automatic deletion reconciliation', () => {
    expect(createMissingProjectCheck()(join(selected, '.tmp', 'removed'))).toBe(false)
  })

  it('does not infer deletion after the selected grant is revoked', () => {
    const isMissing = createMissingProjectCheck()
    revokePath(workspace)

    expect(isMissing(join(selected, 'removed'))).toBe(false)
  })

  it('does not infer child deletion when the granted target is missing', () => {
    rmSync(workspace, { recursive: true })

    expect(createMissingProjectCheck()(join(selected, 'removed'))).toBe(false)
  })
})

describe('project discovery continuity', () => {
  it('does not retain an unrelated obsolete repository because another child is unreadable', () => {
    const blocked = join(root, 'blocked')
    const obsolete = join(root, 'obsolete')
    for (const repository of [blocked, obsolete])
      mkdirSync(join(repository, '.git'), { recursive: true })
    const before = discoverProjects([root])
    rmSync(join(obsolete, '.git'), { recursive: true })
    const read = permissions.readAllowedDirectoryEntries
    vi.spyOn(permissions, 'readAllowedDirectoryEntries').mockImplementation((path, limit) =>
      path === blocked ? { status: 'unavailable', entries: [] } : read(path, limit)
    )

    const after = discoverProjects([root], before.projects)

    expect(after.projects.some((entry) => entry.path === obsolete)).toBe(false)
    expect(after.projects).toContainEqual({
      path: blocked,
      kind: 'repository',
      status: 'unavailable'
    })
  })

  it('drops a deleted discovered child while retaining its readable parent and sibling', () => {
    const removed = join(root, 'removed')
    const remaining = join(root, 'remaining')
    for (const repository of [removed, remaining])
      mkdirSync(join(repository, '.git'), { recursive: true })
    const before = discoverProjects([root])
    rmSync(removed, { recursive: true })

    const after = discoverProjects([root], before.projects)

    expect(after.projects).toEqual([
      { path: root, kind: 'folder', status: 'available' },
      { path: remaining, kind: 'repository', status: 'available' }
    ])
    expect(after.skillRoots.some((entry) => entry.projectRoot === removed)).toBe(false)
  })

  it('keeps an unreadable child without marking its readable parent or siblings unavailable', () => {
    const blocked = join(root, 'blocked')
    const healthy = join(root, 'healthy')
    for (const repository of [blocked, healthy])
      mkdirSync(join(repository, '.git'), { recursive: true })
    const before = discoverProjects([root])
    const readEntries = permissions.readAllowedDirectoryEntries
    const readDirectory = permissions.readAllowedDirectory
    vi.spyOn(permissions, 'readAllowedDirectoryEntries').mockImplementation((path, limit) =>
      path === blocked ? { entries: [], status: 'unavailable' } : readEntries(path, limit)
    )
    vi.spyOn(permissions, 'readAllowedDirectory').mockImplementation((path, limit) =>
      path === blocked ? { entries: [], status: 'unavailable' } : readDirectory(path, limit)
    )

    const after = discoverProjects([root], before.projects)

    expect(after.projects).toContainEqual({ path: root, kind: 'folder', status: 'available' })
    expect(after.projects).toContainEqual({
      path: healthy,
      kind: 'repository',
      status: 'available'
    })
    expect(after.projects).toContainEqual({
      path: blocked,
      kind: 'repository',
      status: 'unavailable'
    })
    expect(after.incomplete).toBe(true)
  })

  it.each(process.platform === 'win32' ? ['.tmp', '.temp', '.TMP'] : ['.tmp', '.temp'])(
    'ignores automatically discovered repositories under %s',
    (temporaryName) => {
      const temporaryRepo = join(root, temporaryName, 'fixture-project')
      const repository = join(root, 'real-project')
      for (const directory of [temporaryRepo, repository]) {
        mkdirSync(join(directory, '.git'), { recursive: true })
        mkdirSync(join(directory, '.claude', 'skills'), { recursive: true })
      }

      const result = discoverProjects([root])

      expect(result.incomplete).toBe(false)
      expect(result.projects.map((entry) => entry.path).sort()).toEqual([root, repository].sort())
      expect(result.skillRoots.some((entry) => entry.projectRoot === temporaryRepo)).toBe(false)
    }
  )

  it.each(['.tmp', '.temp', 'node_modules'])(
    'does not resurrect cached projects under an excluded %s directory',
    (excludedName) => {
      const excludedRepo = join(root, excludedName, 'deleted-fixture')
      const previous: ProjectFolder[] = [
        { path: excludedRepo, kind: 'repository', status: 'available' }
      ]

      const result = discoverProjects([root], previous)

      expect(result.projects).toEqual([{ path: root, kind: 'folder', status: 'available' }])
      expect(result.skillRoots.some((entry) => entry.projectRoot === excludedRepo)).toBe(false)
    }
  )

  it('honors an explicit repository grant inside a temporary folder after deletion', () => {
    const repository = join(root, '.tmp', 'selected-project')
    mkdirSync(join(repository, '.git'), { recursive: true })
    grantPath(repository)
    const before = discoverProjects([root, repository])
    expect(before.projects).toContainEqual({
      path: repository,
      kind: 'repository',
      status: 'available'
    })

    rmSync(repository, { recursive: true })
    const after = discoverProjects([root, repository], before.projects)

    expect(after.incomplete).toBe(false)
    expect(after.projects).toContainEqual({
      path: repository,
      kind: 'repository',
      status: 'missing'
    })
    expect(after.skillRoots).toContainEqual({
      dir: join(repository, '.claude', 'skills'),
      sourceType: 'project',
      projectRoot: repository
    })
  })

  it('does not restore excluded projects when an unrelated discovery limit is reached', () => {
    const excludedRepo = join(root, '.tmp', 'old-fixture')
    const repository = join(root, 'real-project')
    mkdirSync(repository)
    const result = discoverProjects(
      [root],
      [
        { path: excludedRepo, kind: 'repository', status: 'missing' },
        { path: repository, kind: 'repository', status: 'available' }
      ],
      { maxDepth: 64, maxDirectories: 1 }
    )

    expect(result.incomplete).toBe(true)
    expect(result.projects).toContainEqual({
      path: repository,
      kind: 'repository',
      status: 'unavailable'
    })
    expect(result.projects.some((entry) => entry.path === excludedRepo)).toBe(false)
    expect(result.skillRoots.some((entry) => entry.projectRoot === excludedRepo)).toBe(false)
  })

  it('preserves monorepo ownership with overlapping package grants in either order', () => {
    const repo = join(root, 'repo')
    const packagePath = join(repo, 'packages', 'web')
    const skills = join(packagePath, '.claude', 'skills')
    mkdirSync(join(repo, '.git'), { recursive: true })
    mkdirSync(skills, { recursive: true })
    grantPath(packagePath)
    for (const grants of [
      [packagePath, root],
      [root, packagePath]
    ]) {
      const result = discoverProjects(grants)
      expect(result.skillRoots.find((entry) => entry.dir === skills)?.projectRoot).toBe(repo)
      expect(
        result.projects.filter((entry) => entry.kind === 'repository').map((entry) => entry.path)
      ).toEqual([repo])
      expect(result.projects).toContainEqual({
        path: packagePath,
        kind: 'folder',
        status: 'available'
      })
    }
  })
  it('retains a missing directly granted repository and its identity', () => {
    const repo = join(root, 'moved')
    mkdirSync(join(repo, '.git'), { recursive: true })
    grantPath(repo)
    const before = discoverProjects([repo])
    rmSync(repo, { recursive: true })
    expect(discoverProjects([repo], before.projects).projects).toEqual([
      { path: repo, kind: 'repository', status: 'missing' }
    ])
  })

  it('keeps cached repositories unavailable after discovery runs out of budget', () => {
    const repo = join(root, 'repo')
    mkdirSync(join(repo, '.git'), { recursive: true })
    const previous = discoverProjects([root]).projects
    const after = discoverProjects([root], previous, { maxDepth: 64, maxDirectories: 1 })
    expect(after.incomplete).toBe(true)
    expect(after.projects).toContainEqual({ path: repo, kind: 'repository', status: 'unavailable' })
  })

  it('does not resurrect entries outside the remaining grants', () => {
    const repo = join(root, 'repo')
    mkdirSync(join(repo, '.git'), { recursive: true })
    const previous = discoverProjects([root]).projects
    revokePath(root)
    grantPath(repo)
    expect(discoverProjects([repo], previous).projects.map((entry) => entry.path)).toEqual([repo])
  })

  it('ignores malformed persisted catalog entries without granting their paths', () => {
    const malformed = [
      { path: 42 },
      { path: '../escape', kind: 'repository' },
      null
    ] as unknown as ProjectFolder[]
    expect(discoverProjects([root], malformed).projects).toEqual([
      { path: root, kind: 'folder', status: 'available' }
    ])
  })

  it('keeps nested Claude packages within their unversioned owning project', () => {
    const repo = join(root, 'plain')
    mkdirSync(join(repo, '.claude'), { recursive: true })
    writeFileSync(join(repo, '.claude', 'settings.json'), '{}')
    const skills = join(repo, 'packages', 'web', '.claude', 'skills')
    mkdirSync(skills, { recursive: true })
    const result = discoverProjects([root])
    expect(
      result.projects.filter((entry) => entry.kind === 'repository').map((entry) => entry.path)
    ).toEqual([repo])
    expect(result.skillRoots).toContainEqual({
      dir: skills,
      sourceType: 'project',
      projectRoot: repo
    })
  })

  it('discovers sibling and descendant Git boundaries with their own skill ownership', () => {
    const repo = join(root, 'repo')
    const nested = join(repo, 'references', 'nested-repo')
    const sibling = join(repo, 'other-repo')
    const grandchild = join(nested, 'grandchild')
    for (const directory of [repo, nested, sibling, grandchild]) {
      mkdirSync(join(directory, '.claude', 'skills'), { recursive: true })
      if (directory === grandchild) writeFileSync(join(directory, '.git'), 'gitdir: outside')
      else mkdirSync(join(directory, '.git'))
    }
    const packageSkills = join(grandchild, 'packages', 'web', '.claude', 'skills')
    mkdirSync(packageSkills, { recursive: true })
    const result = discoverProjects([root])
    expect(
      result.projects
        .filter((entry) => entry.kind === 'repository')
        .map((entry) => entry.path)
        .sort()
    ).toEqual([repo, nested, sibling, grandchild].sort())
    for (const directory of [repo, nested, sibling, grandchild]) {
      expect(result.skillRoots).toContainEqual({
        dir: join(directory, '.claude', 'skills'),
        sourceType: 'project',
        projectRoot: directory
      })
    }
    expect(result.skillRoots).toContainEqual({
      dir: packageSkills,
      sourceType: 'project',
      projectRoot: grandchild
    })
  })

  it('starts a Git repository beneath an unversioned Claude project', () => {
    mkdirSync(join(root, '.claude', 'skills'), { recursive: true })
    const child = join(root, 'child')
    mkdirSync(join(child, '.git'), { recursive: true })
    expect(discoverProjects([root]).projects).toContainEqual({
      path: child,
      kind: 'repository',
      status: 'available'
    })
  })

  it('skips __MACOSX directories during project traversal', () => {
    const repo = join(root, 'repo')
    const macDir = join(repo, '__MACOSX', 'nested')
    mkdirSync(join(repo, '.git'), { recursive: true })
    mkdirSync(join(macDir, '.git'), { recursive: true })
    const result = discoverProjects([root])
    expect(
      result.projects.filter((entry) => entry.kind === 'repository').map((entry) => entry.path)
    ).toEqual([repo])
  })

  describe('nested Git repositories without Claude Code content', () => {
    let repo: string
    beforeEach(() => {
      repo = join(root, 'repo')
      mkdirSync(join(repo, '.git'), { recursive: true })
    })
    const repositories = (projects: ProjectFolder[]): string[] =>
      projects
        .filter((entry) => entry.kind === 'repository')
        .map((entry) => entry.path)
        .sort()

    it('omits an empty clone inside a repository but keeps an empty top-level repository', () => {
      const clone = join(repo, 'references', 'clone')
      mkdirSync(join(clone, '.git'), { recursive: true })
      mkdirSync(join(clone, 'src'))
      const empty = join(root, 'empty')
      mkdirSync(join(empty, '.git'), { recursive: true })
      expect(repositories(discoverProjects([root]).projects)).toEqual([empty, repo].sort())
    })

    it('omits an empty submodule whose .git is a file', () => {
      const submodule = join(repo, 'vendor-lib')
      mkdirSync(submodule)
      writeFileSync(join(submodule, '.git'), 'gitdir: ../.git/modules/vendor-lib')
      expect(repositories(discoverProjects([root]).projects)).toEqual([repo])
    })

    it('keeps nested repositories with their own skills or settings', () => {
      const withSkills = join(repo, 'skills-clone')
      const withSettings = join(repo, 'settings-clone')
      mkdirSync(join(withSkills, '.git'), { recursive: true })
      mkdirSync(join(withSkills, '.claude', 'skills'), { recursive: true })
      mkdirSync(join(withSettings, '.git'), { recursive: true })
      mkdirSync(join(withSettings, '.claude'))
      writeFileSync(join(withSettings, '.claude', 'settings.local.json'), '{}')
      expect(repositories(discoverProjects([root]).projects)).toEqual(
        [repo, withSkills, withSettings].sort()
      )
    })

    it('keeps a nested repository whose unversioned package holds its skills', () => {
      const clone = join(repo, 'clone')
      const packageSkills = join(clone, 'packages', 'web', '.claude', 'skills')
      mkdirSync(join(clone, '.git'), { recursive: true })
      mkdirSync(packageSkills, { recursive: true })
      const result = discoverProjects([root])
      expect(repositories(result.projects)).toEqual([repo, clone].sort())
      expect(result.skillRoots).toContainEqual({
        dir: packageSkills,
        sourceType: 'project',
        projectRoot: clone
      })
    })

    it('hides an empty repository inside a hidden clone but keeps a configured one', () => {
      const clone = join(repo, 'clone')
      const emptyInner = join(clone, 'inner')
      const configuredInner = join(clone, 'configured')
      for (const directory of [clone, emptyInner, configuredInner])
        mkdirSync(join(directory, '.git'), { recursive: true })
      mkdirSync(join(configuredInner, '.claude', 'skills'), { recursive: true })
      expect(repositories(discoverProjects([root]).projects)).toEqual(
        [repo, configuredInner].sort()
      )
    })

    it('keeps an empty nested repository the user granted directly', () => {
      const clone = join(repo, 'clone')
      mkdirSync(join(clone, '.git'), { recursive: true })
      grantPath(clone)
      for (const grants of [
        [root, clone],
        [clone, root]
      ]) {
        expect(repositories(discoverProjects(grants).projects)).toEqual([repo, clone].sort())
      }
    })

    it('keeps nested repositories when discovery runs out of budget', () => {
      const clone = join(repo, 'a', 'clone')
      mkdirSync(join(clone, '.git'), { recursive: true })
      mkdirSync(join(repo, 'z'))
      // root, repo, a, clone fit the budget; z does not, so the scan is incomplete.
      const result = discoverProjects([root], [], { maxDepth: 64, maxDirectories: 4 })
      expect(result.incomplete).toBe(true)
      expect(repositories(result.projects)).toEqual([repo, clone].sort())
    })

    it('drops a cached entry for a nested repository that is now hidden', () => {
      const clone = join(repo, 'clone')
      mkdirSync(join(clone, '.git'), { recursive: true })
      const previous: ProjectFolder[] = [
        { path: repo, kind: 'repository', status: 'available' },
        { path: clone, kind: 'repository', status: 'available' }
      ]
      expect(repositories(discoverProjects([root], previous).projects)).toEqual([repo])
    })

    it('still offers the hidden repository skill root so cached rows reconcile', () => {
      const clone = join(repo, 'clone')
      mkdirSync(join(clone, '.git'), { recursive: true })
      expect(discoverProjects([root]).skillRoots).toContainEqual({
        dir: join(clone, '.claude', 'skills'),
        sourceType: 'project',
        projectRoot: clone
      })
    })
  })

  it('prunes previously cached nested entries on a complete scan when readable', () => {
    const repo = join(root, 'repo')
    const nested = join(repo, 'references', 'nested-repo')
    mkdirSync(join(repo, '.git'), { recursive: true })
    mkdirSync(join(nested, '.git'), { recursive: true })
    const previous: ProjectFolder[] = [
      { path: repo, kind: 'repository', status: 'available' },
      { path: nested, kind: 'repository', status: 'available' }
    ]
    rmSync(join(nested, '.git'), { recursive: true })
    const result = discoverProjects([root], previous)
    expect(
      result.projects.filter((entry) => entry.kind === 'repository').map((entry) => entry.path)
    ).toEqual([repo])
  })
})

describe('git worktrees', () => {
  // Mirrors what `git worktree add` writes on both sides of the link.
  function addWorktree(
    commonDir: string,
    worktree: string,
    head = 'ref: refs/heads/feature'
  ): void {
    const name = worktree.split(/[\\/]/).pop()!
    const entry = join(commonDir, 'worktrees', name)
    mkdirSync(entry, { recursive: true })
    writeFileSync(join(entry, 'commondir'), '../..\n')
    writeFileSync(join(entry, 'gitdir'), `${join(worktree, '.git')}\n`)
    writeFileSync(join(entry, 'HEAD'), `${head}\n`)
    mkdirSync(worktree, { recursive: true })
    writeFileSync(join(worktree, '.git'), `gitdir: ${entry}\n`)
  }
  function addSkills(directory: string): string {
    const skills = join(directory, '.claude', 'skills')
    mkdirSync(join(skills, 'review'), { recursive: true })
    writeFileSync(join(skills, 'review', 'SKILL.md'), '---\nname: review\n---\n')
    return skills
  }
  const repositories = (projects: ProjectFolder[]): string[] =>
    projects
      .filter((entry) => entry.kind === 'repository')
      .map((entry) => entry.path)
      .sort()
  const rootDirs = (result: ReturnType<typeof discoverProjects>): string[] =>
    result.skillRoots.map((entry) => entry.dir)

  let app: string
  beforeEach(() => {
    app = join(root, 'code', 'app')
    mkdirSync(join(app, '.git'), { recursive: true })
    addSkills(app)
  })

  it('links every worktree a repository lists, even outside the grant', () => {
    addWorktree(join(app, '.git'), join(root, 'elsewhere', 'app-feature'))
    resetGrantedPaths()
    grantPath(app)

    expect(discoverProjects([app]).worktrees).toEqual([
      { path: join(root, 'elsewhere', 'app-feature'), canonical: app }
    ])
  })

  it('neither lists, scans, nor walks into a worktree found under a grant', () => {
    const worktree = join(root, 'code', 'app-feature')
    addWorktree(join(app, '.git'), worktree)
    const worktreeSkills = addSkills(worktree)
    const packageSkills = addSkills(join(worktree, 'packages', 'web'))

    const result = discoverProjects([root])

    expect(repositories(result.projects)).toEqual([app])
    expect(rootDirs(result)).not.toContain(worktreeSkills)
    expect(rootDirs(result)).not.toContain(packageSkills)
    expect(result.skippedWorktrees).toEqual([worktree])
    expect(result.worktrees).toEqual([{ path: worktree, canonical: app }])
  })

  it('uses the checkout pointer when a copied repository also lists that worktree', () => {
    const checkout = join(root, 'worktree')
    addWorktree(join(root, 'zz-copy', '.git'), checkout)
    addWorktree(join(app, '.git'), checkout)
    expect(discoverProjects([root]).worktrees).toEqual([{ path: checkout, canonical: app }])
  })

  it('leaves a checkout independent when its named admin directory is gone', () => {
    const checkout = join(root, 'worktree')
    addWorktree(join(app, '.git'), checkout)
    rmSync(join(app, '.git', 'worktrees', 'worktree'), { recursive: true })
    const result = discoverProjects([root])
    expect(result.worktrees).toEqual([])
    expect(repositories(result.projects)).toContain(checkout)
  })

  it('links a worktree to its main checkout after the checkout was renamed', () => {
    const worktree = join(root, 'wt')
    addWorktree(join(app, '.git'), worktree)
    const moved = join(root, 'code', 'app-moved')
    renameSync(app, moved)
    const result = discoverProjects([root])

    expect(result.worktrees).toEqual([{ path: worktree, canonical: moved }])
    expect(repositories(result.projects)).toEqual([moved])
    expect(result.skippedWorktrees).toEqual([worktree])
  })

  it('keeps a repository whose core.worktree names itself through a symlink', () => {
    // Sorts after `code`, so the walk reaches the repository by its real path first.
    const alias = join(root, 'zz-alias')
    symlinkSync(app, alias, process.platform === 'win32' ? 'junction' : 'dir')
    writeFileSync(join(app, '.git', 'config'), `[core]\n worktree = ${gitPath(alias)}\n`)
    const result = discoverProjects([root])

    expect(repositories(result.projects)).toEqual([app])
    expect(rootDirs(result)).toContain(join(app, '.claude', 'skills'))
  })

  it.skipIf(!caseInsensitive)(
    'keeps a repository whose core.worktree names itself in another letter case',
    () => {
      writeFileSync(
        join(app, '.git', 'config'),
        `[core]\n worktree = ${gitPath(join(root, 'code', 'APP'))}\n`
      )
      expect(repositories(discoverProjects([root]).projects)).toEqual([app])
    }
  )

  it("does not make a standalone git dir's core.worktree target a repository", () => {
    const home = join(root, 'home')
    const dotfiles = join(home, '.dotfiles')
    for (const name of ['objects', 'refs']) mkdirSync(join(dotfiles, name), { recursive: true })
    writeFileSync(join(dotfiles, 'HEAD'), 'ref: refs/heads/main\n')
    writeFileSync(join(dotfiles, 'config'), `[core]\n bare = false\n worktree = ${gitPath(home)}\n`)
    const notes = join(home, 'notes')
    const skills = addSkills(notes)
    const result = discoverProjects([home])

    expect(repositories(result.projects)).toEqual([notes])
    expect(result.skillRoots).toContainEqual({
      dir: skills,
      sourceType: 'project',
      projectRoot: notes
    })
  })

  it('keeps a submodule named worktrees/x and its own linked worktree independent', () => {
    const common = join(app, '.git', 'modules', 'worktrees', 'x')
    const submodule = join(app, 'worktrees', 'x')
    const checkout = join(root, 'worktree')
    addWorktree(common, checkout)
    addSkills(submodule)
    writeFileSync(join(submodule, '.git'), 'gitdir: ../../.git/modules/worktrees/x\n')
    const result = discoverProjects([root])
    expect(result.worktrees).toEqual([])
    expect(repositories(result.projects)).toEqual([app, submodule, checkout].sort())
  })

  it('links a worktree to an ungranted repository from its own .git file', () => {
    const worktree = join(root, 'workspaces', 'app-feature')
    addWorktree(join(app, '.git'), worktree)
    addSkills(worktree)
    resetGrantedPaths()
    grantPath(join(root, 'workspaces'))

    const result = discoverProjects([join(root, 'workspaces')])

    expect(repositories(result.projects)).toEqual([])
    expect(result.skippedWorktrees).toEqual([worktree])
    expect(result.worktrees).toEqual([{ path: worktree, canonical: app }])
  })

  it('lets a directly granted worktree stand in for an ungranted repository', () => {
    const worktree = join(root, 'workspaces', 'app-feature')
    addWorktree(join(app, '.git'), worktree)
    const skills = addSkills(worktree)
    resetGrantedPaths()
    grantPath(worktree)

    const result = discoverProjects([worktree])

    expect(repositories(result.projects)).toEqual([worktree])
    expect(result.skillRoots).toContainEqual({
      dir: skills,
      sourceType: 'project',
      projectRoot: worktree
    })
    expect(result.skippedWorktrees).toEqual([])
    expect(result.worktrees).toEqual([{ path: worktree, canonical: app }])
  })

  it('lets a directly granted worktree stand in when a parent grant also covers it', () => {
    const workspaces = join(root, 'workspaces')
    const worktree = join(workspaces, 'app-feature')
    addWorktree(join(app, '.git'), worktree)
    addSkills(worktree)
    resetGrantedPaths()
    grantPath(workspaces)
    grantPath(worktree)

    const result = discoverProjects([workspaces, worktree])

    expect(repositories(result.projects)).toEqual([worktree])
    expect(result.skippedWorktrees).toEqual([])
  })

  it("drops a directly granted worktree's skills when a parent grant covers its repository", () => {
    const worktree = join(root, 'workspaces', 'app-feature')
    addWorktree(join(app, '.git'), worktree)
    const skills = addSkills(worktree)
    grantPath(worktree)

    const result = discoverProjects([root, worktree])

    expect(rootDirs(result)).not.toContain(skills)
    expect(result.skippedWorktrees).toEqual([worktree])
  })

  it('stops a directly granted worktree standing in once its repository is granted', () => {
    const worktree = join(root, 'workspaces', 'app-feature')
    addWorktree(join(app, '.git'), worktree)
    const skills = addSkills(worktree)
    resetGrantedPaths()
    grantPath(app)
    grantPath(worktree)

    const result = discoverProjects([app, worktree])

    expect(repositories(result.projects)).toEqual([app])
    expect(rootDirs(result)).not.toContain(skills)
    expect(result.skippedWorktrees).toEqual([worktree])
  })

  it('lets only the first directly granted worktree by path stand in', () => {
    const first = join(root, 'workspaces', 'a')
    const second = join(root, 'workspaces', 'b')
    addWorktree(join(app, '.git'), second)
    addWorktree(join(app, '.git'), first)
    resetGrantedPaths()
    grantPath(second)
    grantPath(first)

    const result = discoverProjects([second, first])

    expect(repositories(result.projects)).toEqual([first])
    expect(result.skippedWorktrees).toEqual([second])
  })

  describe('bare repositories', () => {
    it.each([
      { survivors: 1, prune: true },
      { survivors: 2, prune: true },
      { survivors: 2, prune: false }
    ])(
      'credits surviving checkouts after changing the canonical ($survivors survivors, prune=$prune)',
      ({ survivors, prune }) => {
        const bare = join(project, '.bare')
        initBare(bare)
        const main = join(project, 'main')
        const a = join(project, 'a-feature')
        const z = join(project, 'z-dev')
        addWorktree(bare, main, 'ref: refs/heads/main')
        addWorktree(bare, a, 'ref: refs/heads/feature')
        if (survivors === 2) addWorktree(bare, z, 'ref: refs/heads/dev')
        for (const checkout of [main, a, ...(survivors === 2 ? [z] : [])]) {
          const dir = join(addSkills(checkout), 'deploy')
          mkdirSync(dir)
          writeFileSync(
            join(dir, 'SKILL.md'),
            '---\nname: deploy\ndescription: Deploy\n---\nDeploy'
          )
        }
        const db = new Database(':memory:')
        applySchema(db)
        try {
          const first = scanSkills(db)
          let locations = applyWorktreeEvidence(
            reconcileUsageProjects([], first.projects!, []),
            first.worktrees!
          )
          if (prune) {
            rmSync(main, { recursive: true })
            rmSync(join(bare, 'worktrees', 'main'), { recursive: true })
          } else writeFileSync(join(bare, 'HEAD'), 'ref: refs/heads/feature\n')
          const second = scanSkills(db, undefined, undefined, first.projects)
          locations = applyWorktreeEvidence(
            JSON.parse(JSON.stringify(locations)),
            second.worktrees!,
            second.canonicalCheckouts
          )
          setWorktreeLinkSource(() => worktreeLinks(locations))
          for (const [index, cwd] of [a, ...(survivors === 2 ? [z] : [])].entries()) {
            db.prepare(
              'INSERT INTO sessions_meta (session_id, cwd, started_at, message_count, source_mtime_ms) VALUES (?, ?, ?, 1, 1)'
            ).run(String(index), cwd, '2026-11-18T00:00:00Z')
            db.prepare(
              "INSERT INTO skill_invocations (source_uuid, session_id, skill_name, invoked_at, trigger_type) VALUES (?, ?, 'deploy', ?, 'user_invoked')"
            ).run(String(index), String(index), '2026-11-18T00:00:00Z')
          }
          expect(listSkills(db).find((skill) => skill.project_root === a)).toMatchObject({
            total_invocations: survivors
          })
          expect(locations.find((entry) => entry.path === a)?.worktree).toBeUndefined()
          expect(second.canonicalCheckouts).toContain(a)
        } finally {
          setWorktreeLinkSource(() => [])
          db.close()
        }
      }
    )

    let project: string
    beforeEach(() => {
      project = join(root, 'project')
    })
    function initBare(commonDir: string): void {
      mkdirSync(join(commonDir, 'objects'), { recursive: true })
      mkdirSync(join(commonDir, 'refs'))
      writeFileSync(join(commonDir, 'config'), '[core]\n\tbare = true\n')
      writeFileSync(join(commonDir, 'HEAD'), 'ref: refs/heads/main\n')
      // A nested-looking repository inside the git dir must never be discovered.
      mkdirSync(join(commonDir, 'objects', 'stray', '.git'), { recursive: true })
    }

    it('scans only the worktree on the default branch of a bare repository', () => {
      const bare = join(project, '.bare')
      initBare(bare)
      addWorktree(bare, join(project, 'feature'), 'ref: refs/heads/feature')
      addWorktree(bare, join(project, 'main'), 'ref: refs/heads/main')
      addSkills(join(project, 'feature'))
      const skills = addSkills(join(project, 'main'))

      const result = discoverProjects([root])

      expect(repositories(result.projects)).toEqual([app, join(project, 'main')].sort())
      expect(result.skillRoots).toContainEqual({
        dir: skills,
        sourceType: 'project',
        projectRoot: join(project, 'main')
      })
      expect(result.skippedWorktrees).toEqual([join(project, 'feature')])
      expect(result.worktrees).toEqual([
        { path: join(project, 'feature'), canonical: join(project, 'main') }
      ])
    })

    it('discovers around a bare repository that has no worktrees', () => {
      initBare(join(root, 'remote.git'))

      const result = discoverProjects([root])

      expect(repositories(result.projects)).toEqual([app])
      expect(result.worktrees).toEqual([])
    })

    it('does not treat the folder holding a bare .git as a repository', () => {
      initBare(join(project, '.git'))
      addWorktree(join(project, '.git'), join(project, 'main'), 'ref: refs/heads/main')

      expect(repositories(discoverProjects([root]).projects)).toEqual(
        [app, join(project, 'main')].sort()
      )
    })

    it('links a directly granted bare container and excludes its own skills', () => {
      const bare = join(project, '.bare')
      const main = join(project, 'main')
      initBare(bare)
      writeFileSync(join(project, '.git'), 'gitdir: ./.bare\n')
      const containerSkills = addSkills(project)
      addWorktree(bare, main, 'ref: refs/heads/main')
      const result = discoverProjects([project])

      expect(result.projects.map(({ path }) => path)).toEqual([main])
      expect(rootDirs(result)).not.toContain(containerSkills)
      expect(result.skippedWorktrees).toContain(project)
      expect(result.worktrees).toContainEqual({ path: project, canonical: main })
    })

    it('uses the previous live canonical until the bare default branch appears', () => {
      const bare = join(root, 'remote.git')
      const first = join(root, 'a')
      const former = join(root, 'z')
      initBare(bare)
      addWorktree(bare, first, 'ref: refs/heads/a')
      addWorktree(bare, former, 'ref: refs/heads/z')
      const saved = [{ path: first, canonical: former }]
      expect(discoverProjects([root], [], undefined, saved).worktrees).toEqual(saved)
      writeFileSync(join(bare, 'HEAD'), 'ref: refs/heads/a\n')
      expect(discoverProjects([root], [], undefined, saved).worktrees).toEqual([
        { path: former, canonical: first }
      ])
    })

    it('keeps a locked default-branch checkout as canonical while it is offline', () => {
      const bare = join(root, 'remote.git')
      const main = join(root, 'main')
      const dev = join(root, 'dev')
      initBare(bare)
      addWorktree(bare, main, 'ref: refs/heads/main')
      addWorktree(bare, dev, 'ref: refs/heads/dev')
      writeFileSync(join(bare, 'worktrees', 'main', 'locked'), 'unmounted volume')
      rmSync(main, { recursive: true })
      expect(discoverProjects([root]).worktrees).toEqual([{ path: dev, canonical: main }])
    })
  })

  it('links worktrees to the checkout of a separate git dir', () => {
    const store = join(root, 'store', 'app.git')
    const separate = join(root, 'code', 'separate')
    mkdirSync(store, { recursive: true })
    mkdirSync(separate)
    writeFileSync(join(separate, '.git'), `gitdir: ${store}\n`)
    const worktree = join(root, 'code', 'separate-feature')
    addWorktree(store, worktree)
    resetGrantedPaths()
    grantPath(join(root, 'code'))

    const result = discoverProjects([join(root, 'code')])

    expect(repositories(result.projects)).toEqual([app, separate].sort())
    expect(result.worktrees).toEqual([{ path: worktree, canonical: separate }])
  })

  it('leaves a directly granted worktree independent when the separate checkout is unknown', () => {
    const store = join(root, 'store', 'app.git')
    const checkout = join(root, 'wt')
    addWorktree(store, checkout)
    const skills = addSkills(checkout)
    const result = discoverProjects([store, checkout])

    expect(result.worktrees).toEqual([])
    expect(rootDirs(result)).toContain(skills)
  })

  it('removes a .git holder when the real checkout points at that git directory', () => {
    const holder = join(root, 'holder')
    const checkout = join(root, 'separate')
    mkdirSync(join(holder, '.git'), { recursive: true })
    mkdirSync(checkout)
    writeFileSync(join(checkout, '.git'), 'gitdir: ../holder/.git\n')
    const result = discoverProjects([root])

    expect(repositories(result.projects)).toEqual([app, checkout].sort())
    expect(rootDirs(result)).not.toContain(join(holder, '.claude', 'skills'))
  })

  it('discovers a core.worktree checkout without a .git entry of its own', () => {
    const checkout = join(root, 'a-redirected-checkout')
    const holder = join(root, 'z-holder')
    const common = join(holder, '.git')
    const skills = addSkills(join(checkout, 'packages', 'web'))
    const worktree = join(root, 'wt')
    addWorktree(common, worktree)
    writeFileSync(join(common, 'config'), '[core]\n worktree = ../../a-redirected-checkout\n')
    const result = discoverProjects([root])

    expect(repositories(result.projects)).toEqual([app, checkout].sort())
    expect(result.skillRoots).toContainEqual({
      dir: skills,
      sourceType: 'project',
      projectRoot: checkout
    })
    expect(result.worktrees).toEqual([{ path: worktree, canonical: checkout }])
  })

  it('drops fresh links to a missing core.worktree directory inside a grant', () => {
    const common = join(root, 'holder', '.git')
    const worktree = join(root, 'wt')
    addWorktree(common, worktree)
    writeFileSync(join(common, 'config'), '[core]\n worktree = ../../missing\n')
    expect(discoverProjects([root]).worktrees).toEqual([])
  })
})
