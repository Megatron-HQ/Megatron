import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { grantPath, resetGrantedPaths, revokePath } from '../permissions'
import { discoverProjects } from './project-discovery'
import type { ProjectFolder } from '../../shared/ipc'

let root: string
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'megatron-project-discovery-')))
  grantPath(root)
})
afterEach(() => {
  resetGrantedPaths()
  rmSync(root, { recursive: true, force: true })
})

describe('project discovery continuity', () => {
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
