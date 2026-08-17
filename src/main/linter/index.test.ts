import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { applySchema } from '../db/schema'
import { listSkills, getLintFindingsForSkill } from '../db/queries'
import { grantPath, resetGrantedPaths } from '../permissions'
import { runLinter } from './index'

describe('runLinter', () => {
  let db: Database.Database
  let tmpDir: string

  beforeEach(() => {
    db = new Database(':memory:')
    applySchema(db)
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'megatron-linter-test-'))
    grantPath(tmpDir)
  })

  afterEach(() => {
    resetGrantedPaths()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('runs all rules and populates lint_findings in database', () => {
    // Skill 1: Broken frontmatter
    const skillDir1 = path.join(tmpDir, 'broken-yaml')
    fs.mkdirSync(skillDir1)
    fs.writeFileSync(path.join(skillDir1, 'SKILL.md'), 'not valid frontmatter')

    // Skill 2: Clean skill
    const skillDir2 = path.join(tmpDir, 'clean-skill')
    fs.mkdirSync(skillDir2)
    fs.writeFileSync(
      path.join(skillDir2, 'SKILL.md'),
      '---\nname: clean-skill\ndescription: Everything is good\n---\nValid body'
    )

    // Insert both skills
    db.prepare(
      `INSERT INTO skills (name, source_type, source_path, plugin_name, description, last_scanned_at)
       VALUES ('broken-yaml', 'global', ?, NULL, NULL, ?)`
    ).run(skillDir1, new Date().toISOString())

    db.prepare(
      `INSERT INTO skills (name, source_type, source_path, plugin_name, description, last_scanned_at)
       VALUES ('clean-skill', 'global', ?, NULL, 'Everything is good', ?)`
    ).run(skillDir2, new Date().toISOString())

    const skills = listSkills(db)
    expect(skills).toHaveLength(2)

    // Run linter
    runLinter(db)

    const updatedSkills = listSkills(db)
    const brokenSkill = updatedSkills.find((s) => s.name === 'broken-yaml')!
    const cleanSkill = updatedSkills.find((s) => s.name === 'clean-skill')!

    expect(brokenSkill.lint_status).toBe('error')
    expect(brokenSkill.error_count).toBeGreaterThan(0)

    expect(cleanSkill.lint_status).toBe('clean')
    expect(cleanSkill.error_count).toBe(0)
    expect(cleanSkill.warning_count).toBe(0)

    const brokenFindings = getLintFindingsForSkill(db, brokenSkill.id)
    expect(brokenFindings.length).toBeGreaterThan(0)
    expect(brokenFindings[0].rule_id).toBe('yaml-frontmatter')
  })
})
