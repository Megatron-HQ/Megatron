import Database from 'better-sqlite3'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { join, resolve } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applySchema } from '../db/schema'
import { grantPath, resetGrantedPaths, revokePath } from '../permissions'
import {
  defaultSkillRoots,
  findNestedSkillsDirs,
  scanSkills,
  type SkillRoot
} from './skills-scanner'

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
  db = new Database(':memory:')
  applySchema(db)
  tmpDir = mkdtempSync(join(tmpdir(), 'megatron-test-'))
  userSettingsPath = join(tmpDir, 'user-settings.json')
  grantPath(tmpDir)
})

afterEach(() => {
  resetGrantedPaths()
  rmSync(tmpDir, { recursive: true, force: true })
})

describe('scanSkills', () => {
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

  it.skipIf(process.platform === 'win32')(
    'discovers a skill reached through a symlink whose real target lives outside the scanned root',
    () => {
      const root = join(tmpDir, 'skills')
      mkdirSync(root, { recursive: true })

      // Real files live in a location that was never granted — only the symlink's
      // own path (inside `root`) is checked against the allowlist. This matches how
      // symlink-sync skill managers (e.g. the Vercel `skills` CLI, or `references/
      // skills-manager`, whose default sync mode is symlink) lay skills out on disk.
      const externalDir = mkdtempSync(join(tmpdir(), 'megatron-external-'))
      try {
        const realSkillDir = writeSkillDir(
          externalDir,
          'linked-skill',
          '---\nname: linked-skill\ndescription: Reached via symlink\n---\nBody'
        )
        const linkPath = join(root, 'linked-skill')
        symlinkSync(realSkillDir, linkPath, 'dir')

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
    }
  )

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

describe('defaultSkillRoots', () => {
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
