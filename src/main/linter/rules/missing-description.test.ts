import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { grantPath, resetGrantedPaths } from '../../permissions'
import { missingDescriptionRule } from './missing-description'
import type { SkillLintTarget, LinterContext } from '../types'

describe('missingDescriptionRule', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'megatron-rule2-test-'))
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
      description: null
    }
    const findings = missingDescriptionRule.run(skill, dummyContext)
    expect(findings).toEqual([])
  })

  it('skips if frontmatter is missing or invalid', () => {
    const skillDir = path.join(tmpDir, 'skill-1')
    fs.mkdirSync(skillDir)
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), 'not frontmatter')
    const skill: SkillLintTarget = {
      id: 1,
      name: 'skill-1',
      source_type: 'global',
      source_path: skillDir,
      plugin_name: null,
      description: null
    }

    const findings = missingDescriptionRule.run(skill, dummyContext)
    expect(findings).toEqual([])
  })

  it('returns finding if description is missing from frontmatter', () => {
    const skillDir = path.join(tmpDir, 'skill-1')
    fs.mkdirSync(skillDir)
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: my-skill\n---\n# Content')
    const skill: SkillLintTarget = {
      id: 1,
      name: 'my-skill',
      source_type: 'global',
      source_path: skillDir,
      plugin_name: null,
      description: null
    }

    const findings = missingDescriptionRule.run(skill, dummyContext)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      rule_id: 'missing-description',
      severity: 'error',
      message: 'Missing or empty description'
    })
  })

  it('returns finding if description is empty or whitespace', () => {
    const skillDir = path.join(tmpDir, 'skill-1')
    fs.mkdirSync(skillDir)
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: my-skill\ndescription: "   "\n---\n# Content'
    )
    const skill: SkillLintTarget = {
      id: 1,
      name: 'my-skill',
      source_type: 'project',
      source_path: skillDir,
      plugin_name: null,
      description: '   '
    }

    const findings = missingDescriptionRule.run(skill, dummyContext)
    expect(findings).toHaveLength(1)
    expect(findings[0].rule_id).toBe('missing-description')
  })

  it('returns empty array when valid description is present', () => {
    const skillDir = path.join(tmpDir, 'skill-1')
    fs.mkdirSync(skillDir)
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      '---\nname: my-skill\ndescription: Useful skill\n---\n# Content'
    )
    const skill: SkillLintTarget = {
      id: 1,
      name: 'my-skill',
      source_type: 'global',
      source_path: skillDir,
      plugin_name: null,
      description: 'Useful skill'
    }

    const findings = missingDescriptionRule.run(skill, dummyContext)
    expect(findings).toEqual([])
  })
})
