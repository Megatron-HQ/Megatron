import Database from 'better-sqlite3'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { join, resolve } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applySchema } from '../db/schema'
import { grantPath, resetGrantedPaths } from '../permissions'
import { defaultSkillRoots, scanSkills, type SkillRoot } from './skills-scanner'

let db: Database.Database
let tmpDir: string

interface SkillRow {
  id: number
  name: string
  source_type: string
  source_path: string
  plugin_name: string | null
  description: string | null
  last_scanned_at: string
  project_root: string | null
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

beforeEach(() => {
  db = new Database(':memory:')
  applySchema(db)
  tmpDir = mkdtempSync(join(tmpdir(), 'megatron-test-'))
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
})
