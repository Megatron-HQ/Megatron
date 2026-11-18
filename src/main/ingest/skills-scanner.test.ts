import Database from 'better-sqlite3'
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync
} from 'fs'
import { homedir, tmpdir } from 'os'
import { join, resolve } from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as permissions from '../permissions'
import { applySchema } from '../db/schema'
import {
  defaultConfigRoot,
  grantPath,
  resetGrantedPaths,
  revokePath,
  setClaudeConfig
} from '../permissions'
import {
  defaultSkillRoots,
  findNestedSkillsDirs,
  scanSkills,
  type SkillRoot
} from './skills-scanner'
import { scanPluginRegistry } from './plugin-registry'
import { scanTranscripts } from './transcript-scanner'
import { scanPromptHistory } from './prompt-history-scanner'
import { createUsageScanTasks } from './usage-scan-tasks'
import { runAllScans } from './scan-all'
import { openUsageArchive } from '../db/usage-archive'

let db: Database.Database
let tmpDir: string
let userSettingsPath: string

interface SkillRow {
  id: number
  name: string
  source_type: string
  source_path: string
  plugin_name: string | null
  description: string | null
  last_scanned_at: string
  project_root: string | null
  created_at: string | null
  modified_at: string | null
  is_synced: number
  disabled_reason: string | null
  model_invocable: number
}

function allSkills(): SkillRow[] {
  return db.prepare('SELECT * FROM skills ORDER BY source_path').all() as SkillRow[]
}

function writeSkillDir(rootDir: string, name: string, frontmatter: string): string {
  const dirPath = join(rootDir, name)
  mkdirSync(dirPath, { recursive: true })
  writeFileSync(join(dirPath, 'SKILL.md'), frontmatter)
  return dirPath
}

function writeUserSettings(content: unknown): void {
  writeFileSync(userSettingsPath, JSON.stringify(content))
}

beforeEach(() => {
  setClaudeConfig(defaultConfigRoot(homedir()))
  db = new Database(':memory:')
  applySchema(db)
  tmpDir = realpathSync(mkdtempSync(join(tmpdir(), 'megatron-test-')))
  userSettingsPath = join(tmpDir, 'user-settings.json')
  grantPath(tmpDir)
})

describe('live project reconciliation', () => {
  it('does not commit archive coverage if the profile disappears while the archive opens', () => {
    const directory = join(tmpDir, 'profile')
    mkdirSync(directory)
    writeFileSync(
      join(directory, 'history.jsonl'),
      JSON.stringify({
        sessionId: 'saved',
        project: '/repo',
        timestamp: 1794960000000,
        display: 'hello'
      })
    )
    setClaudeConfig({ directory, claudeJson: join(directory, '.claude.json'), source: 'settings' })
    const archive = openUsageArchive(':memory:')
    let opens = 0
    try {
      const result = runAllScans(
        db,
        createUsageScanTasks({
          scanTranscripts,
          scanPromptHistory,
          getArchive: () => {
            if (++opens === 2) rmSync(directory, { recursive: true })
            return archive
          }
        })
      )
      expect(result.sources.find((entry) => entry.name === 'archivePrompts')?.status).toBe('failed')
      expect(archive.prepare('SELECT COUNT(*) AS count FROM history_coverage').get()).toEqual({
        count: 0
      })
      expect(archive.prepare('SELECT COUNT(*) AS count FROM history_prompts').get()).toEqual({
        count: 0
      })
    } finally {
      archive.close()
    }
  })

  it.each(['plugins', 'transcripts'] as const)(
    'retains cached %s when the profile disappears during enumeration',
    (source) => {
      const directory = join(tmpDir, 'profile')
      mkdirSync(join(directory, source === 'plugins' ? 'plugins' : 'projects'), { recursive: true })
      writeFileSync(join(directory, 'settings.json'), '{}')
      setClaudeConfig({
        directory,
        claudeJson: join(directory, '.claude.json'),
        source: 'settings'
      })
      db.prepare(
        "INSERT INTO sessions_meta (session_id, cwd, started_at, message_count, source_mtime_ms) VALUES ('saved', '/repo', '2026-11-18T00:00:00Z', 1, 1)"
      ).run()
      db.prepare(
        "INSERT INTO plugin_registry (name, marketplace, installed_version, scope, install_path, last_scanned_at) VALUES ('saved', 'market', '1', 'user', '/cache', '2026-11-18T00:00:00Z')"
      ).run()
      const read = permissions.readAllowedDirectory
      vi.spyOn(permissions, 'readAllowedDirectory').mockImplementation((path, limit) => {
        if (path === join(directory, source === 'plugins' ? 'plugins' : 'projects'))
          rmSync(directory, { recursive: true, force: true })
        return read(path, limit)
      })
      expect(() => (source === 'plugins' ? scanPluginRegistry(db) : scanTranscripts(db))).toThrow(
        'unavailable'
      )
      expect(db.prepare('SELECT session_id FROM sessions_meta').all()).toEqual([
        { session_id: 'saved' }
      ])
      expect(db.prepare('SELECT name FROM plugin_registry').all()).toEqual([{ name: 'saved' }])
    }
  )

  it('does not archive unavailable sources as fresh coverage', () => {
    const directory = join(tmpDir, 'disconnected')
    setClaudeConfig({
      directory,
      claudeJson: join(directory, '.claude.json'),
      source: 'environment'
    })
    const archive = openUsageArchive(':memory:')
    try {
      const tasks = createUsageScanTasks({
        scanTranscripts,
        scanPromptHistory,
        getArchive: () => archive
      })
      const result = runAllScans(db, tasks)
      expect(result.outcome).not.toBe('complete')
      expect(result.sources.find((entry) => entry.name === 'archiveTokens')?.status).not.toBe(
        'complete'
      )
      expect(result.sources.find((entry) => entry.name === 'archivePrompts')?.status).not.toBe(
        'complete'
      )
    } finally {
      archive.close()
    }
  })

  it('still removes global skills intentionally deleted inside a present named profile', () => {
    const directory = join(tmpDir, 'profile')
    const skills = join(directory, 'skills')
    writeSkillDir(skills, 'removed', '---\nname: removed\n---\nBody')
    setClaudeConfig({ directory, claudeJson: join(directory, '.claude.json'), source: 'settings' })
    scanSkills(db)
    rmSync(skills, { recursive: true })
    expect(scanSkills(db).status).toBe('complete')
    expect(allSkills()).toEqual([])
  })

  it.each(['settings', 'environment'] as const)(
    'preserves a global skill after a %s profile disappears during its read',
    (source) => {
      const directory = join(tmpDir, 'profile')
      const skills = join(directory, 'skills')
      writeSkillDir(skills, 'saved', '---\nname: saved\n---\nBody')
      writeFileSync(join(directory, 'settings.json'), '{}')
      setClaudeConfig({ directory, claudeJson: join(directory, '.claude.json'), source })
      scanSkills(db)
      expect(allSkills()).toHaveLength(1)
      const read = permissions.readAllowedDirectory
      vi.spyOn(permissions, 'readAllowedDirectory').mockImplementation((path, limit) => {
        if (path === skills) rmSync(directory, { recursive: true, force: true })
        return read(path, limit)
      })
      expect(() => scanSkills(db)).toThrow('unavailable')
      expect(allSkills()).toHaveLength(1)
    }
  )

  it('removes stale skills when only a discovered child’s Claude folder is deleted', () => {
    const repository = join(tmpDir, 'still-present')
    writeSkillDir(join(repository, '.claude', 'skills'), 'removed', '---\nname: removed\n---\nBody')
    const before = scanSkills(db, undefined, userSettingsPath)
    rmSync(join(repository, '.claude'), { recursive: true })

    const after = scanSkills(db, undefined, userSettingsPath, before.projects)

    expect(allSkills().filter((row) => row.source_type === 'project')).toEqual([])
    expect(after.projects?.some((entry) => entry.path === repository)).toBe(false)
  })

  it('marks an unreadable skills folder’s own project unavailable while its parent stays available', () => {
    const repository = join(tmpDir, 'blocked-skills')
    const skillsDirectory = join(repository, '.claude', 'skills')
    writeSkillDir(skillsDirectory, 'saved', '---\nname: saved\n---\nBody')
    const before = scanSkills(db, undefined, userSettingsPath)
    const read = permissions.readAllowedDirectory
    vi.spyOn(permissions, 'readAllowedDirectory').mockImplementation((path, limit) =>
      path === skillsDirectory ? { status: 'unavailable', entries: [] } : read(path, limit)
    )

    const after = scanSkills(db, undefined, userSettingsPath, before.projects)

    expect(after.projects).toContainEqual({ path: tmpDir, kind: 'folder', status: 'available' })
    expect(after.projects).toContainEqual({
      path: repository,
      kind: 'repository',
      status: 'unavailable'
    })
    expect(
      allSkills()
        .filter((row) => row.source_type === 'project')
        .map((row) => row.name)
    ).toEqual(['saved'])
  })

  it('removes deleted child skills even when the old project catalog is unavailable', () => {
    const repository = join(tmpDir, 'removed')
    writeSkillDir(
      join(repository, '.claude', 'skills'),
      'old-skill',
      '---\nname: old-skill\n---\nBody'
    )
    scanSkills(db, undefined, userSettingsPath)
    rmSync(repository, { recursive: true })

    const result = scanSkills(db, undefined, userSettingsPath)

    expect(allSkills().filter((row) => row.source_type === 'project')).toEqual([])
    expect(result.status).toBe('complete')
  })

  it('rediscovers moved child skills at their new path without retaining the old project', () => {
    const oldRoot = join(tmpDir, 'before')
    const newRoot = join(tmpDir, 'after')
    writeSkillDir(join(oldRoot, '.claude', 'skills'), 'moving', '---\nname: moving\n---\nBody')
    const before = scanSkills(db, undefined, userSettingsPath)
    renameSync(oldRoot, newRoot)

    const after = scanSkills(db, undefined, userSettingsPath, before.projects)

    expect(
      allSkills()
        .filter((row) => row.source_type === 'project')
        .map((row) => row.project_root)
    ).toEqual([newRoot])
    expect(after.projects?.some((project) => project.path === oldRoot)).toBe(false)
  })

  it('drops the skills of a repository that turns out to be a worktree', () => {
    const app = join(tmpDir, 'app')
    const worktree = join(tmpDir, 'app-feature')
    mkdirSync(join(app, '.git'), { recursive: true })
    mkdirSync(join(worktree, '.git'), { recursive: true })
    writeSkillDir(join(worktree, '.claude', 'skills'), 'branchy', '---\nname: branchy\n---\nBody')
    const before = scanSkills(db, undefined, userSettingsPath)
    const projectRoots = (): (string | null)[] =>
      allSkills()
        .filter((row) => row.source_type === 'project')
        .map((row) => row.project_root)
    expect(projectRoots()).toEqual([worktree])
    const entry = join(app, '.git', 'worktrees', 'app-feature')
    mkdirSync(entry, { recursive: true })
    writeFileSync(join(entry, 'commondir'), '../..\n')
    writeFileSync(join(entry, 'gitdir'), `${join(worktree, '.git')}\n`)
    rmSync(join(worktree, '.git'), { recursive: true })
    writeFileSync(join(worktree, '.git'), `gitdir: ${entry}\n`)

    const after = scanSkills(db, undefined, userSettingsPath, before.projects)

    expect(projectRoots()).toEqual([])
    expect(after.findings?.worktrees).toEqual([{ path: worktree, canonical: app }])
  })

  it('retains cached skills for a missing individually granted project', () => {
    const repository = join(tmpDir, 'direct')
    writeSkillDir(join(repository, '.claude', 'skills'), 'saved', '---\nname: saved\n---\nBody')
    grantPath(repository)
    const before = scanSkills(db, undefined, userSettingsPath)
    rmSync(repository, { recursive: true })

    scanSkills(db, undefined, userSettingsPath, before.projects)

    expect(
      allSkills()
        .filter((row) => row.source_type === 'project')
        .map((row) => row.name)
    ).toEqual(['saved'])
  })
})

describe('project skills linked outside their repository', () => {
  let external: string

  beforeEach(() => {
    external = realpathSync(mkdtempSync(join(tmpdir(), 'megatron-link-target-')))
  })

  afterEach(() => {
    rmSync(external, { recursive: true, force: true })
  })

  function linkedRepository(): {
    repository: string
    skills: string
    link: string
    target: string
  } {
    const repository = join(tmpDir, 'linked-repo')
    const skills = join(repository, '.claude', 'skills')
    writeSkillDir(skills, 'kept', '---\nname: kept\n---\nBody')
    writeSkillDir(skills, 'deleted', '---\nname: deleted\n---\nBody')
    const target = writeSkillDir(external, 'shared', '---\nname: shared\n---\nBody')
    const link = join(skills, 'shared')
    symlinkSync(target, link, process.platform === 'win32' ? 'junction' : 'dir')
    return { repository, skills, link, target }
  }

  function projectSkillNames(): string[] {
    return allSkills()
      .filter((row) => row.source_type === 'project')
      .map((row) => row.name)
      .sort()
  }

  it('reports the link and the folder it points to', () => {
    const { link, target } = linkedRepository()

    const result = scanSkills(db, undefined, userSettingsPath)

    expect(result.status).toBe('partial')
    expect(result.issues).toContainEqual({ code: 'link_unapproved', path: link, target })
  })

  it('keeps the repository available and indexes the sibling skills', () => {
    const { repository } = linkedRepository()

    const result = scanSkills(db, undefined, userSettingsPath)

    expect(result.projects).toContainEqual({
      path: repository,
      kind: 'repository',
      status: 'available'
    })
    expect(projectSkillNames()).toEqual(['deleted', 'kept'])
  })

  it('still sweeps a deleted sibling skill while the link stays blocked', () => {
    const { skills } = linkedRepository()
    const before = scanSkills(db, undefined, userSettingsPath)
    rmSync(join(skills, 'deleted'), { recursive: true })

    scanSkills(db, undefined, userSettingsPath, before.projects)

    expect(projectSkillNames()).toEqual(['kept'])
  })

  it('drops the cached row once the link target is no longer granted', () => {
    linkedRepository()
    grantPath(external)
    const before = scanSkills(db, undefined, userSettingsPath)
    expect(projectSkillNames()).toEqual(['deleted', 'kept', 'shared'])
    revokePath(external)

    scanSkills(db, undefined, userSettingsPath, before.projects)

    expect(projectSkillNames()).toEqual(['deleted', 'kept'])
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  resetGrantedPaths()
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('scanSkills', () => {
  it('removes indexed skills belonging only to an excluded temporary project', () => {
    const repository = join(tmpDir, '.tmp', 'old-fixture')
    const skillsDirectory = join(repository, '.claude', 'skills')
    writeSkillDir(skillsDirectory, 'temporary-demo', '---\nname: temporary-demo\n---\nBody')
    writeUserSettings({})
    scanSkills(
      db,
      [{ dir: skillsDirectory, sourceType: 'project', projectRoot: repository }],
      userSettingsPath
    )
    expect(allSkills().filter((row) => row.project_root === repository)).toHaveLength(1)
    rmSync(repository, { recursive: true })

    const result = scanSkills(db, undefined, userSettingsPath, [
      { path: repository, kind: 'repository', status: 'available' }
    ])

    expect(result.status).toBe('complete')
    expect(allSkills().filter((row) => row.project_root === repository)).toEqual([])
  })

  it('keeps a missing explicitly selected temporary project cached', () => {
    const repository = join(tmpDir, '.tmp', 'selected-project')
    const skillsDirectory = join(repository, '.claude', 'skills')
    writeSkillDir(skillsDirectory, 'selected-demo', '---\nname: selected-demo\n---\nBody')
    writeUserSettings({})
    grantPath(repository)
    const before = scanSkills(db, undefined, userSettingsPath)
    const indexed = allSkills().find((row) => row.project_root === repository)
    expect(indexed).toBeDefined()
    rmSync(repository, { recursive: true })

    const result = scanSkills(db, undefined, userSettingsPath, before.projects)

    expect(result.issues).toContainEqual({ code: 'project_missing', path: repository })
    expect(allSkills().find((row) => row.project_root === repository)).toEqual(indexed)
  })

  it('reports empty repositories and unversioned projects beneath a parent grant', () => {
    const emptyRepo = join(tmpDir, 'empty')
    const plainProject = join(tmpDir, 'clients', 'plain')
    mkdirSync(join(emptyRepo, '.git'), { recursive: true })
    mkdirSync(join(plainProject, '.claude'), { recursive: true })
    writeFileSync(join(plainProject, '.claude', 'settings.json'), '{}')
    writeUserSettings({})

    const result = scanSkills(db, undefined, userSettingsPath)

    expect(result).toMatchObject({
      projects: expect.arrayContaining([
        { path: tmpDir, kind: 'folder', status: 'available' },
        { path: emptyRepo, kind: 'repository', status: 'available' },
        { path: plainProject, kind: 'repository', status: 'available' }
      ])
    })
  })

  it('uses an unversioned project own settings instead of its grouping folder', () => {
    const repo = join(tmpDir, 'plain')
    writeSkillDir(join(repo, '.claude', 'skills'), 'demo', '---\nname: demo\n---\nBody')
    writeFileSync(join(repo, '.claude', 'settings.json'), '{"skillOverrides":{"demo":"off"}}')
    writeUserSettings({})

    scanSkills(db, undefined, userSettingsPath)

    expect(allSkills().find((row) => row.source_path.startsWith(repo))).toMatchObject({
      project_root: repo,
      disabled_reason: 'override'
    })
  })

  it('includes invalid settings diagnostics while preserving the indexed skills', () => {
    const root = join(tmpDir, 'skills')
    writeSkillDir(root, 'demo', '---\nname: demo\n---\nBody')
    writeUserSettings({})
    const roots: SkillRoot[] = [{ dir: root, sourceType: 'global' }]
    scanSkills(db, roots, userSettingsPath)
    const before = allSkills()
    writeFileSync(userSettingsPath, '{invalid')

    expect(scanSkills(db, roots, userSettingsPath)).toMatchObject({
      status: 'partial',
      issues: [{ code: 'settings_invalid', path: userSettingsPath }]
    })
    expect(allSkills()).toEqual(before)
  })

  it('reports incomplete nested discovery even before a hidden root has been indexed', () => {
    const hidden = join(tmpDir, 'hidden')
    mkdirSync(hidden)
    const directory = permissions.readAllowedDirectoryEntries
    vi.spyOn(permissions, 'readAllowedDirectoryEntries').mockImplementation((path) =>
      path === hidden ? { status: 'unavailable', entries: [] } : directory(path)
    )
    expect(scanSkills(db, defaultSkillRoots(), userSettingsPath)).toMatchObject({
      status: 'partial'
    })
  })
  it('keeps collision-qualified names stable while one root is unavailable', () => {
    const top = join(tmpDir, '.claude', 'skills')
    const nested = join(tmpDir, 'package', '.claude', 'skills')
    writeSkillDir(top, 'demo', '---\nname: demo\n---\nBody')
    writeSkillDir(nested, 'demo', '---\nname: demo\n---\nBody')
    const roots: SkillRoot[] = [
      { dir: top, sourceType: 'project', projectRoot: tmpDir },
      { dir: nested, sourceType: 'project', projectRoot: tmpDir }
    ]
    scanSkills(db, roots, userSettingsPath)
    const directory = permissions.readAllowedDirectory
    vi.spyOn(permissions, 'readAllowedDirectory').mockImplementation((path) =>
      path === top ? { status: 'unavailable', entries: [] } : directory(path)
    )
    scanSkills(db, roots, userSettingsPath)
    expect(
      allSkills()
        .map((row) => row.name)
        .sort()
    ).toEqual(['demo', 'package:demo'])
  })
  it('preserves unreadable skill metadata while updating readable siblings', () => {
    const root = join(tmpDir, 'skills')
    const dir = writeSkillDir(root, 'a', '---\nname: a\ndescription: Before\n---\nBody')
    writeSkillDir(root, 'b', '---\nname: b\ndescription: Before\n---\nBody')
    const roots: SkillRoot[] = [{ dir: root, sourceType: 'global' }]
    scanSkills(db, roots, userSettingsPath)
    const before = allSkills().find((row) => row.name === 'a')
    writeSkillDir(root, 'b', '---\nname: b\ndescription: After\n---\nBody')
    const read = permissions.readAllowedFile
    vi.spyOn(permissions, 'readAllowedFile').mockImplementation((path, limit) =>
      path === join(dir, 'SKILL.md') ? { status: 'unavailable', contents: null } : read(path, limit)
    )
    expect(scanSkills(db, roots, userSettingsPath)).toMatchObject({ status: 'partial' })
    expect(allSkills().find((row) => row.name === 'a')).toEqual(before)
    expect(allSkills().find((row) => row.name === 'b')?.description).toBe('After')
  })

  it('removes deleted nested and synced roots after a complete scan', () => {
    const top = join(tmpDir, '.claude', 'skills')
    const nested = join(tmpDir, 'package', '.claude', 'skills')
    writeSkillDir(nested, 'nested', '---\nname: nested\n---\nBody')
    writeSkillDir(join(top, 'synced'), 'synced-demo', '---\nname: synced-demo\n---\nBody')
    const roots: SkillRoot[] = [
      { dir: top, sourceType: 'project', projectRoot: tmpDir },
      { dir: nested, sourceType: 'project', projectRoot: tmpDir }
    ]
    scanSkills(db, roots, userSettingsPath)
    expect(allSkills()).toHaveLength(2)
    rmSync(join(tmpDir, 'package'), { recursive: true })
    rmSync(join(top, 'synced'), { recursive: true })
    scanSkills(db, roots.slice(0, 1), userSettingsPath)
    expect(allSkills()).toEqual([])
  })
  it('inserts two skills with real SKILL.md files, correctly tagged', () => {
    const root = join(tmpDir, 'skills')
    writeSkillDir(root, 'skill-a', '---\nname: skill-a\ndescription: First\n---\nBody')
    writeSkillDir(root, 'skill-b', '---\nname: skill-b\ndescription: Second\n---\nBody')

    scanSkills(db, [{ dir: root, sourceType: 'global' }])

    const rows = allSkills()
    expect(rows).toHaveLength(2)
    expect(rows.map((r) => r.name)).toEqual(['skill-a', 'skill-b'])
    expect(rows.every((r) => r.source_type === 'global')).toBe(true)
  })

  it('does not insert a stray non-skill file or a directory with no SKILL.md', () => {
    const root = join(tmpDir, 'skills')
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, 'summary.md'), 'not a skill')
    mkdirSync(join(root, 'empty-dir'), { recursive: true })
    writeSkillDir(root, 'real-skill', '---\nname: real-skill\ndescription: Real\n---\nBody')

    scanSkills(db, [{ dir: root, sourceType: 'global' }])

    const rows = allSkills()
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('real-skill')
  })

  it('updates the same row on rescan after editing a description, not duplicating', () => {
    const root = join(tmpDir, 'skills')
    const dirPath = writeSkillDir(
      root,
      'skill-a',
      '---\nname: skill-a\ndescription: First\n---\nBody'
    )
    const roots: SkillRoot[] = [{ dir: root, sourceType: 'global' }]

    scanSkills(db, roots)
    const firstId = allSkills()[0].id

    writeFileSync(join(dirPath, 'SKILL.md'), '---\nname: skill-a\ndescription: Updated\n---\nBody')
    scanSkills(db, roots)

    const rows = allSkills()
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe(firstId)
    expect(rows[0].description).toBe('Updated')
  })

  it('removes a row when its skill directory is removed from disk', () => {
    const root = join(tmpDir, 'skills')
    writeSkillDir(root, 'skill-a', '---\nname: skill-a\ndescription: First\n---\nBody')
    const skillBDir = writeSkillDir(
      root,
      'skill-b',
      '---\nname: skill-b\ndescription: Second\n---\nBody'
    )
    const roots: SkillRoot[] = [{ dir: root, sourceType: 'global' }]

    scanSkills(db, roots)
    expect(allSkills()).toHaveLength(2)

    rmSync(skillBDir, { recursive: true, force: true })
    scanSkills(db, roots)

    const rows = allSkills()
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('skill-a')
  })

  it('removes all rows when all skills are removed, without throwing', () => {
    const root = join(tmpDir, 'skills')
    writeSkillDir(root, 'skill-a', '---\nname: skill-a\ndescription: First\n---\nBody')
    const roots: SkillRoot[] = [{ dir: root, sourceType: 'global' }]

    scanSkills(db, roots)
    expect(allSkills()).toHaveLength(1)

    rmSync(root, { recursive: true, force: true })
    expect(() => scanSkills(db, roots)).not.toThrow()
    expect(allSkills()).toHaveLength(0)
  })

  it('leaves a pre-existing plugin-tagged row untouched by a global-only scan', () => {
    db.prepare(
      `INSERT INTO skills (name, source_type, source_path, plugin_name, description, last_scanned_at)
       VALUES ('plugin-skill', 'plugin', ?, 'foo@bar', NULL, ?)`
    ).run(join(tmpDir, 'plugin-install', 'plugin-skill'), new Date().toISOString())

    const root = join(tmpDir, 'skills')
    writeSkillDir(root, 'global-skill', '---\nname: global-skill\ndescription: Global\n---\nBody')

    scanSkills(db, [{ dir: root, sourceType: 'global' }])

    const rows = allSkills()
    expect(rows).toHaveLength(2)
    expect(rows.some((r) => r.source_type === 'plugin' && r.name === 'plugin-skill')).toBe(true)
  })

  it("does not delete another un-scanned project root's rows when scanning one project root", () => {
    const projectA = join(tmpDir, 'project-a', '.claude', 'skills')
    const projectBSkillPath = join(tmpDir, 'project-b', '.claude', 'skills', 'other-skill')

    db.prepare(
      `INSERT INTO skills (name, source_type, source_path, plugin_name, description, last_scanned_at)
       VALUES ('other-skill', 'project', ?, NULL, NULL, ?)`
    ).run(projectBSkillPath, new Date().toISOString())

    writeSkillDir(projectA, 'skill-a', '---\nname: skill-a\ndescription: A\n---\nBody')

    scanSkills(db, [{ dir: projectA, sourceType: 'project' }])

    const rows = allSkills()
    expect(rows).toHaveLength(2)
    expect(rows.some((r) => r.source_path === projectBSkillPath)).toBe(true)
  })

  it('does not throw and inserts no rows when the root directory is missing', () => {
    const roots: SkillRoot[] = [{ dir: join(tmpDir, 'does-not-exist'), sourceType: 'global' }]
    expect(() => scanSkills(db, roots)).not.toThrow()
    expect(allSkills()).toHaveLength(0)
  })

  it('preserves indexed skills when a previously readable root becomes unavailable', () => {
    const root = join(tmpDir, 'skills')
    writeSkillDir(root, 'skill-a', '---\nname: skill-a\ndescription: First\n---\nBody')
    const roots: SkillRoot[] = [{ dir: root, sourceType: 'global' }]
    scanSkills(db, roots)

    revokePath(tmpDir)
    scanSkills(db, roots)

    expect(allSkills().map((skill) => skill.name)).toEqual(['skill-a'])
  })

  it('skips an ungranted directory even if it is present on disk', () => {
    resetGrantedPaths()
    const root = join(tmpDir, 'skills')
    writeSkillDir(root, 'skill-a', '---\nname: skill-a\ndescription: First\n---\nBody')

    scanSkills(db, [{ dir: root, sourceType: 'global' }])

    expect(allSkills()).toHaveLength(0)
  })

  it('discovers an external linked skill only after its target is explicitly granted', () => {
    const root = join(tmpDir, 'skills')
    mkdirSync(root, { recursive: true })

    const externalDir = mkdtempSync(join(tmpdir(), 'megatron-external-'))
    try {
      const realSkillDir = writeSkillDir(
        externalDir,
        'linked-skill',
        '---\nname: linked-skill\ndescription: Reached via symlink\n---\nBody'
      )
      const linkPath = join(root, 'linked-skill')
      symlinkSync(realSkillDir, linkPath, process.platform === 'win32' ? 'junction' : 'dir')

      scanSkills(db, [{ dir: root, sourceType: 'global' }])
      expect(allSkills()).toHaveLength(0)

      grantPath(externalDir)

      scanSkills(db, [{ dir: root, sourceType: 'global' }])

      const rows = allSkills()
      expect(rows).toHaveLength(1)
      expect(rows[0].name).toBe('linked-skill')
      expect(rows[0].description).toBe('Reached via symlink')
      // Stored path is where the symlink sits, not the resolved external target.
      expect(rows[0].source_path).toBe(linkPath)
    } finally {
      rmSync(externalDir, { recursive: true, force: true })
    }
  })

  it.skipIf(process.platform === 'win32')(
    'skips a dangling symlink in the scanned root without throwing',
    () => {
      const root = join(tmpDir, 'skills')
      mkdirSync(root, { recursive: true })
      symlinkSync(join(tmpDir, 'nowhere'), join(root, 'broken-link'), 'dir')
      writeSkillDir(root, 'real-skill', '---\nname: real-skill\ndescription: Real\n---\nBody')

      expect(() => scanSkills(db, [{ dir: root, sourceType: 'global' }])).not.toThrow()

      const rows = allSkills()
      expect(rows).toHaveLength(1)
      expect(rows[0].name).toBe('real-skill')
    }
  )

  it('records project_root on a project-tier skill from the scanned root', () => {
    const root = join(tmpDir, 'my-repo', '.claude', 'skills')
    writeSkillDir(root, 'skill-a', '---\nname: skill-a\ndescription: A\n---\nBody')

    scanSkills(db, [{ dir: root, sourceType: 'project', projectRoot: join(tmpDir, 'my-repo') }])

    expect(allSkills()[0].project_root).toBe(join(tmpDir, 'my-repo'))
  })

  it('leaves project_root null for a global-tier skill', () => {
    const root = join(tmpDir, 'skills')
    writeSkillDir(root, 'skill-a', '---\nname: skill-a\ndescription: A\n---\nBody')

    scanSkills(db, [{ dir: root, sourceType: 'global' }])

    expect(allSkills()[0].project_root).toBeNull()
  })

  it('records last_scanned_at as a valid ISO8601 string', () => {
    const root = join(tmpDir, 'skills')
    writeSkillDir(root, 'skill-a', '---\nname: skill-a\ndescription: First\n---\nBody')

    scanSkills(db, [{ dir: root, sourceType: 'global' }])

    const row = allSkills()[0]
    expect(new Date(row.last_scanned_at).toISOString()).toBe(row.last_scanned_at)
  })

  it('records created_at and modified_at as valid ISO8601 strings for a scanned skill', () => {
    const root = join(tmpDir, 'skills')
    writeSkillDir(root, 'skill-a', '---\nname: skill-a\ndescription: First\n---\nBody')

    scanSkills(db, [{ dir: root, sourceType: 'global' }])

    const row = allSkills()[0]
    expect(row.created_at).not.toBeNull()
    expect(row.modified_at).not.toBeNull()
    expect(new Date(row.created_at as string).toISOString()).toBe(row.created_at)
    expect(new Date(row.modified_at as string).toISOString()).toBe(row.modified_at)
  })

  it('records modified_at reflecting a real file mtime change', () => {
    const root = join(tmpDir, 'skills')
    const dirPath = writeSkillDir(
      root,
      'skill-a',
      '---\nname: skill-a\ndescription: First\n---\nBody'
    )
    const future = new Date(Date.now() + 60000)
    utimesSync(join(dirPath, 'SKILL.md'), future, future)

    scanSkills(db, [{ dir: root, sourceType: 'global' }])

    const row = allSkills()[0]
    expect(row.modified_at).toBe(future.toISOString())
  })

  it('discovers a skill nested under synced/, tagged is_synced and global', () => {
    const root = join(tmpDir, 'skills')
    writeSkillDir(join(root, 'synced'), 'foo', '---\nname: foo\ndescription: Synced\n---\nBody')

    scanSkills(db, [{ dir: root, sourceType: 'global' }])

    const rows = allSkills()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      name: 'foo',
      source_type: 'global',
      is_synced: 1,
      source_path: join(root, 'synced', 'foo')
    })
  })

  it('does not treat synced/ itself as a skill even when it has its own SKILL.md', () => {
    const root = join(tmpDir, 'skills')
    writeSkillDir(root, 'synced', '---\nname: synced\ndescription: Not real\n---\nBody')
    writeSkillDir(join(root, 'synced'), 'foo', '---\nname: foo\ndescription: Real\n---\nBody')

    scanSkills(db, [{ dir: root, sourceType: 'global' }])

    const rows = allSkills()
    expect(rows).toHaveLength(1)
    expect(rows[0].name).toBe('foo')
  })

  it('treats Synced/ and SYNCED/ as the reserved folder, case-insensitively', () => {
    const root = join(tmpDir, 'skills')
    writeSkillDir(join(root, 'Synced'), 'foo', '---\nname: foo\ndescription: A\n---\nBody')

    scanSkills(db, [{ dir: root, sourceType: 'global' }])

    expect(allSkills()[0]).toMatchObject({ name: 'foo', is_synced: 1 })
  })

  it('reconciles away a synced skill row when its directory is removed from disk', () => {
    const root = join(tmpDir, 'skills')
    const fooDir = writeSkillDir(
      join(root, 'synced'),
      'foo',
      '---\nname: foo\ndescription: A\n---\nBody'
    )
    const roots: SkillRoot[] = [{ dir: root, sourceType: 'global' }]
    scanSkills(db, roots)
    expect(allSkills()).toHaveLength(1)

    rmSync(fooDir, { recursive: true, force: true })
    scanSkills(db, roots)

    expect(allSkills()).toHaveLength(0)
  })

  it('does not mark a skill synced merely because its granted repo path contains a synced segment', () => {
    const root = join(tmpDir, 'synced-repo', '.claude', 'skills')
    writeSkillDir(root, 'foo', '---\nname: foo\ndescription: A\n---\nBody')

    scanSkills(db, [{ dir: root, sourceType: 'project', projectRoot: join(tmpDir, 'synced-repo') }])

    expect(allSkills()[0]).toMatchObject({ name: 'foo', is_synced: 0 })
  })

  it('keeps the bare name for a nested skill with no collision', () => {
    const repoRoot = join(tmpDir, 'my-repo')
    const nestedRoot = join(repoRoot, 'apps', 'web', '.claude', 'skills')
    writeSkillDir(nestedRoot, 'deploy', '---\nname: deploy\ndescription: A\n---\nBody')

    scanSkills(db, [{ dir: nestedRoot, sourceType: 'project', projectRoot: repoRoot }])

    expect(allSkills()[0].name).toBe('deploy')
  })

  it('qualifies a nested skill colliding with a root-level same-named skill, leaving the root one bare', () => {
    const repoRoot = join(tmpDir, 'my-repo')
    const rootLevelRoot = join(repoRoot, '.claude', 'skills')
    const nestedRoot = join(repoRoot, 'apps', 'web', '.claude', 'skills')
    writeSkillDir(rootLevelRoot, 'deploy', '---\nname: deploy\ndescription: Root\n---\nBody')
    writeSkillDir(nestedRoot, 'deploy', '---\nname: deploy\ndescription: Nested\n---\nBody')

    scanSkills(db, [
      { dir: rootLevelRoot, sourceType: 'project', projectRoot: repoRoot },
      { dir: nestedRoot, sourceType: 'project', projectRoot: repoRoot }
    ])

    const rows = allSkills()
    const rootRow = rows.find((r) => r.source_path === join(rootLevelRoot, 'deploy'))
    const nestedRow = rows.find((r) => r.source_path === join(nestedRoot, 'deploy'))
    expect(rootRow?.name).toBe('deploy')
    expect(nestedRow?.name).toBe('apps/web:deploy')
  })

  it('records the granted repo root as project_root for a nested skill, not its own subdirectory', () => {
    const repoRoot = join(tmpDir, 'my-repo')
    const nestedRoot = join(repoRoot, 'apps', 'web', '.claude', 'skills')
    writeSkillDir(nestedRoot, 'deploy', '---\nname: deploy\ndescription: A\n---\nBody')

    scanSkills(db, [{ dir: nestedRoot, sourceType: 'project', projectRoot: repoRoot }])

    expect(allSkills()[0].project_root).toBe(repoRoot)
  })

  it('removes a nested skill row when its directory is deleted from disk on rescan', () => {
    const repoRoot = join(tmpDir, 'my-repo')
    const nestedRoot = join(repoRoot, 'apps', 'web', '.claude', 'skills')
    const skillDir = writeSkillDir(
      nestedRoot,
      'deploy',
      '---\nname: deploy\ndescription: A\n---\nBody'
    )
    const roots: SkillRoot[] = [{ dir: nestedRoot, sourceType: 'project', projectRoot: repoRoot }]

    scanSkills(db, roots)
    expect(allSkills()).toHaveLength(1)

    rmSync(skillDir, { recursive: true, force: true })
    scanSkills(db, roots)

    expect(allSkills()).toHaveLength(0)
  })
})

describe('scanSkills disabled_reason via skillOverrides', () => {
  it('sets disabled_reason to override for a global skill set to off in user settings', () => {
    const root = join(tmpDir, 'skills')
    writeSkillDir(root, 'skill-a', '---\nname: skill-a\ndescription: First\n---\nBody')
    writeUserSettings({ skillOverrides: { 'skill-a': 'off' } })

    scanSkills(db, [{ dir: root, sourceType: 'global' }], userSettingsPath)

    expect(allSkills()[0].disabled_reason).toBe('override')
  })

  it('leaves disabled_reason NULL for a global skill set to name-only', () => {
    const root = join(tmpDir, 'skills')
    writeSkillDir(root, 'skill-a', '---\nname: skill-a\ndescription: First\n---\nBody')
    writeUserSettings({ skillOverrides: { 'skill-a': 'name-only' } })

    scanSkills(db, [{ dir: root, sourceType: 'global' }], userSettingsPath)

    expect(allSkills()[0].disabled_reason).toBeNull()
  })

  it('leaves disabled_reason NULL for a global skill with no override at all', () => {
    const root = join(tmpDir, 'skills')
    writeSkillDir(root, 'skill-a', '---\nname: skill-a\ndescription: First\n---\nBody')

    scanSkills(db, [{ dir: root, sourceType: 'global' }], userSettingsPath)

    expect(allSkills()[0].disabled_reason).toBeNull()
  })

  it('picks up a project-scope override for a project skill', () => {
    const repoRoot = join(tmpDir, 'my-repo')
    const root = join(repoRoot, '.claude', 'skills')
    writeSkillDir(root, 'skill-a', '---\nname: skill-a\ndescription: First\n---\nBody')
    mkdirSync(join(repoRoot, '.claude'), { recursive: true })
    writeFileSync(
      join(repoRoot, '.claude', 'settings.json'),
      JSON.stringify({ skillOverrides: { 'skill-a': 'off' } })
    )

    scanSkills(db, [{ dir: root, sourceType: 'project', projectRoot: repoRoot }], userSettingsPath)

    expect(allSkills()[0].disabled_reason).toBe('override')
  })
})

describe('scanSkills model_invocable', () => {
  it('sets model_invocable to 0 for a skill with disable-model-invocation: true in frontmatter', () => {
    const root = join(tmpDir, 'skills')
    writeSkillDir(
      root,
      'skill-a',
      '---\nname: skill-a\ndescription: First\ndisable-model-invocation: true\n---\nBody'
    )

    scanSkills(db, [{ dir: root, sourceType: 'global' }], userSettingsPath)

    expect(allSkills()[0].model_invocable).toBe(0)
  })

  it('sets model_invocable to 0 for a global skill overridden to user-invocable-only', () => {
    const root = join(tmpDir, 'skills')
    writeSkillDir(root, 'skill-a', '---\nname: skill-a\ndescription: First\n---\nBody')
    writeUserSettings({ skillOverrides: { 'skill-a': 'user-invocable-only' } })

    scanSkills(db, [{ dir: root, sourceType: 'global' }], userSettingsPath)

    expect(allSkills()[0].model_invocable).toBe(0)
  })

  it('leaves model_invocable at 1 for a global skill overridden to name-only', () => {
    const root = join(tmpDir, 'skills')
    writeSkillDir(root, 'skill-a', '---\nname: skill-a\ndescription: First\n---\nBody')
    writeUserSettings({ skillOverrides: { 'skill-a': 'name-only' } })

    scanSkills(db, [{ dir: root, sourceType: 'global' }], userSettingsPath)

    expect(allSkills()[0].model_invocable).toBe(1)
  })

  it('leaves model_invocable at 1 for a skill overridden to off, which only sets disabled_reason', () => {
    const root = join(tmpDir, 'skills')
    writeSkillDir(root, 'skill-a', '---\nname: skill-a\ndescription: First\n---\nBody')
    writeUserSettings({ skillOverrides: { 'skill-a': 'off' } })

    scanSkills(db, [{ dir: root, sourceType: 'global' }], userSettingsPath)

    const row = allSkills()[0]
    expect(row.disabled_reason).toBe('override')
    expect(row.model_invocable).toBe(1)
  })

  it('leaves model_invocable at 1 for a plain skill with no flag or override', () => {
    const root = join(tmpDir, 'skills')
    writeSkillDir(root, 'skill-a', '---\nname: skill-a\ndescription: First\n---\nBody')

    scanSkills(db, [{ dir: root, sourceType: 'global' }], userSettingsPath)

    expect(allSkills()[0].model_invocable).toBe(1)
  })
})

describe('findNestedSkillsDirs', () => {
  it('finds a nested .claude/skills directory below the repo root', () => {
    const repoRoot = join(tmpDir, 'my-repo')
    const nestedSkillsDir = join(repoRoot, 'apps', 'web', '.claude', 'skills')
    mkdirSync(nestedSkillsDir, { recursive: true })

    expect(findNestedSkillsDirs(repoRoot)).toEqual([nestedSkillsDir])
  })

  it('does not include the top-level .claude/skills directory itself', () => {
    const repoRoot = join(tmpDir, 'my-repo')
    mkdirSync(join(repoRoot, '.claude', 'skills'), { recursive: true })

    expect(findNestedSkillsDirs(repoRoot)).toEqual([])
  })

  it('does not descend into a skip-listed directory such as node_modules', () => {
    const repoRoot = join(tmpDir, 'my-repo')
    mkdirSync(join(repoRoot, 'node_modules', 'some-pkg', '.claude', 'skills'), {
      recursive: true
    })

    expect(findNestedSkillsDirs(repoRoot)).toEqual([])
  })

  it('does not treat a fixture buried inside a top-level skill as a nested root', () => {
    const repoRoot = join(tmpDir, 'my-repo')
    mkdirSync(
      join(repoRoot, '.claude', 'skills', 'my-skill', 'references', '.claude', 'skills', 'fake'),
      { recursive: true }
    )

    expect(findNestedSkillsDirs(repoRoot)).toEqual([])
  })

  it('returns an empty array without throwing when the repo root does not exist', () => {
    const repoRoot = join(tmpDir, 'does-not-exist')
    expect(() => findNestedSkillsDirs(repoRoot)).not.toThrow()
    expect(findNestedSkillsDirs(repoRoot)).toEqual([])
  })

  it.skipIf(process.platform === 'win32')(
    'terminates on a symlink cycle instead of hanging',
    () => {
      const repoRoot = join(tmpDir, 'my-repo')
      mkdirSync(join(repoRoot, 'a'), { recursive: true })
      symlinkSync(join(repoRoot, 'a'), join(repoRoot, 'a', 'loop'), 'dir')

      expect(() => findNestedSkillsDirs(repoRoot)).not.toThrow()
    }
  )
})

describe('scanSkills under a CLAUDE_CONFIG_DIR folder', () => {
  afterEach(() => {
    setClaudeConfig(defaultConfigRoot(homedir()))
  })

  it('scans the folder’s skills as global and applies its settings.json overrides', () => {
    const work = join(tmpDir, 'claude-work')
    writeSkillDir(join(work, 'skills'), 'demo', '---\nname: demo\n---\nBody')
    writeSkillDir(join(work, 'skills'), 'muted', '---\nname: muted\n---\nBody')
    writeFileSync(join(work, 'settings.json'), '{"skillOverrides":{"muted":"off"}}')
    setClaudeConfig({
      directory: work,
      claudeJson: join(work, '.claude.json'),
      source: 'environment'
    })

    scanSkills(db)

    expect(allSkills().map((row) => [row.source_type, row.name, row.disabled_reason])).toEqual([
      ['global', 'demo', null],
      ['global', 'muted', 'override']
    ])
  })
})

describe('defaultSkillRoots', () => {
  it('reassigns cached nested skills to each Git repository and uses its own settings', () => {
    const parent = join(tmpDir, 'parent')
    const child = join(parent, 'child')
    const grandchild = join(child, 'grandchild')
    writeUserSettings({})
    const paths = [parent, child, grandchild].map((repo) =>
      writeSkillDir(join(repo, '.claude', 'skills'), 'deploy', '---\nname: deploy\n---\nBody')
    )
    mkdirSync(join(parent, '.git'))
    // Seed the earlier ownership before the child repositories become identifiable.
    scanSkills(db, undefined, userSettingsPath)
    mkdirSync(join(child, '.git'))
    writeFileSync(join(grandchild, '.git'), 'gitdir: outside')
    writeFileSync(join(child, '.claude', 'settings.json'), '{"skillOverrides":{"deploy":"off"}}')
    grantPath(child)
    scanSkills(db, undefined, userSettingsPath)
    expect(allSkills().filter((row) => row.source_type === 'project')).toHaveLength(3)
    for (const [index, repo] of [parent, child, grandchild].entries()) {
      expect(allSkills().find((row) => row.source_path === paths[index])).toMatchObject({
        name: 'deploy',
        project_root: repo,
        disabled_reason: repo === child ? 'override' : null
      })
    }
  })

  it('keeps sibling repositories separate when their parent folder is granted', () => {
    const firstRepo = join(tmpDir, 'Megatron')
    const secondRepo = join(tmpDir, 'Megatron-site')
    for (const repo of [firstRepo, secondRepo]) {
      mkdirSync(join(repo, '.git'), { recursive: true })
      writeSkillDir(join(repo, '.claude', 'skills'), 'demo', '---\nname: demo\n---\nBody')
    }
    mkdirSync(join(firstRepo, 'packages', 'web', '.claude'), { recursive: true })
    writeSkillDir(
      join(firstRepo, 'packages', 'web', '.claude', 'skills'),
      'nested',
      '---\nname: nested\n---\nBody'
    )
    writeFileSync(
      join(firstRepo, '.claude', 'settings.json'),
      JSON.stringify({ skillOverrides: { demo: 'off' } })
    )
    writeUserSettings({})

    const roots = defaultSkillRoots().filter((root) => root.sourceType === 'project')
    scanSkills(db, roots, userSettingsPath)

    expect(allSkills().map((row) => [row.project_root, row.name, row.disabled_reason])).toEqual([
      [secondRepo, 'demo', null],
      [firstRepo, 'demo', 'override'],
      [firstRepo, 'nested', null]
    ])
  })

  it('deduplicates repositories covered by both a parent and a direct grant', () => {
    const repo = join(tmpDir, 'repo')
    mkdirSync(join(repo, '.git'), { recursive: true })
    mkdirSync(join(repo, '.claude', 'skills'), { recursive: true })
    grantPath(repo)

    expect(
      defaultSkillRoots().filter((root) => root.dir === join(repo, '.claude', 'skills'))
    ).toHaveLength(1)
  })

  it('recognizes a child worktree without reading its gitdir target', () => {
    const repo = join(tmpDir, 'worktree')
    mkdirSync(join(repo, '.claude', 'skills'), { recursive: true })
    writeFileSync(join(repo, '.git'), 'gitdir: C:/outside-the-grant')

    expect(defaultSkillRoots()).toContainEqual({
      dir: join(repo, '.claude', 'skills'),
      sourceType: 'project',
      projectRoot: repo
    })
  })

  it('includes ~/.claude/skills as a global root', () => {
    const roots = defaultSkillRoots()
    expect(roots).toContainEqual({
      dir: resolve(homedir(), '.claude', 'skills'),
      sourceType: 'global'
    })
  })

  it('includes a granted repo as a project root', () => {
    const repo = join(tmpDir, 'some-repo')
    grantPath(repo)

    const roots = defaultSkillRoots()

    expect(roots).toContainEqual({
      dir: join(repo, '.claude', 'skills'),
      sourceType: 'project',
      projectRoot: repo
    })
  })

  it('includes a nested .claude/skills directory below a granted repo', () => {
    const repo = join(tmpDir, 'some-repo')
    mkdirSync(join(repo, '.git'), { recursive: true })
    grantPath(repo)
    mkdirSync(join(repo, 'apps', 'web', '.claude', 'skills'), { recursive: true })

    const roots = defaultSkillRoots()

    expect(roots).toContainEqual({
      dir: join(repo, 'apps', 'web', '.claude', 'skills'),
      sourceType: 'project',
      projectRoot: repo
    })
  })
})
