import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { grantPath, resetGrantedPaths } from '../../permissions'
import { yamlFrontmatterRule } from './yaml-frontmatter'
import type { SkillLintTarget, LinterContext } from '../types'

describe('yamlFrontmatterRule', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'megatron-rule1-test-'))
    grantPath(tmpDir)
  })

  afterEach(() => {
    resetGrantedPaths()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  const dummyContext: LinterContext = {
    skills: [],
    globalMcpServers: new Set()
  }

  it('skips plugin skills', () => {
    const skill: SkillLintTarget = {
      id: 1,
      name: 'plugin-skill',
      source_type: 'plugin',
      source_path: path.join(tmpDir, 'plugin-skill'),
      plugin_name: 'test@pkg',
      description: 'Some plugin'
    }
    const findings = yamlFrontmatterRule.run(skill, dummyContext)
    expect(findings).toEqual([])
  })

  it('returns finding if SKILL.md is missing', () => {
    const skillDir = path.join(tmpDir, 'skill-1')
    fs.mkdirSync(skillDir)
    const skill: SkillLintTarget = {
      id: 1,
      name: 'skill-1',
      source_type: 'global',
      source_path: skillDir,
      plugin_name: null,
      description: null
    }

    const findings = yamlFrontmatterRule.run(skill, dummyContext)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      rule_id: 'yaml-frontmatter',
      severity: 'error',
      message: 'Missing SKILL.md or frontmatter block'
    })
  })

  it('returns finding if frontmatter block is missing', () => {
    const skillDir = path.join(tmpDir, 'skill-1')
    fs.mkdirSync(skillDir)
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '# Just a header, no frontmatter')
    const skill: SkillLintTarget = {
      id: 1,
      name: 'skill-1',
      source_type: 'global',
      source_path: skillDir,
      plugin_name: null,
      description: null
    }

    const findings = yamlFrontmatterRule.run(skill, dummyContext)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      rule_id: 'yaml-frontmatter',
      severity: 'error',
      message: 'Missing frontmatter block'
    })
  })

  it('returns finding with detail if YAML syntax is malformed', () => {
    const skillDir = path.join(tmpDir, 'skill-1')
    fs.mkdirSync(skillDir)
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: [unclosed array\ndescription: test\n---\n# Body'
    )
    const skill: SkillLintTarget = {
      id: 1,
      name: 'skill-1',
      source_type: 'project',
      source_path: skillDir,
      plugin_name: null,
      description: null
    }

    const findings = yamlFrontmatterRule.run(skill, dummyContext)
    expect(findings).toHaveLength(1)
    expect(findings[0].severity).toBe('error')
    expect(findings[0].message).toBe('Malformed YAML frontmatter')
    expect(findings[0].detail).toBeDefined()
  })

  it('does not read SKILL.md outside allowed paths', () => {
    resetGrantedPaths()
    const skillDir = path.join(tmpDir, 'ungranted-skill')
    fs.mkdirSync(skillDir)
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), 'not valid frontmatter')
    const skill: SkillLintTarget = {
      id: 1,
      name: 'ungranted-skill',
      source_type: 'global',
      source_path: skillDir,
      plugin_name: null,
      description: null
    }

    expect(yamlFrontmatterRule.run(skill, dummyContext)).toEqual([])
  })

  it('returns empty array when valid frontmatter exists', () => {
    const skillDir = path.join(tmpDir, 'skill-1')
    fs.mkdirSync(skillDir)
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: my-skill\ndescription: Valid description\n---\n# Body'
    )
    const skill: SkillLintTarget = {
      id: 1,
      name: 'my-skill',
      source_type: 'global',
      source_path: skillDir,
      plugin_name: null,
      description: 'Valid description'
    }

    const findings = yamlFrontmatterRule.run(skill, dummyContext)
    expect(findings).toEqual([])
  })
})
