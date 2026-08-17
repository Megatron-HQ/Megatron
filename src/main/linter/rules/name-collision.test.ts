import { describe, it, expect } from 'vitest'
import { nameCollisionRule } from './name-collision'
import type { SkillLintTarget, LinterContext } from '../types'

describe('nameCollisionRule', () => {
  it('warns a project skill shadowed by a global, using shadowed_by_skill_id', () => {
    const skill: SkillLintTarget = {
      id: 2,
      name: 'deploy',
      source_type: 'project',
      source_path: '/repo/.claude/skills/deploy',
      plugin_name: null,
      description: null,
      project_root: '/repo',
      shadowed_by_skill_id: 1
    }
    const context: LinterContext = {
      skills: [skill],
      globalMcpServers: new Set()
    }

    const findings = nameCollisionRule.run(skill, context)
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({
      skill_id: 2,
      rule_id: 'name-collision',
      severity: 'warning'
    })
    expect(findings[0].message).toContain('deploy')
  })

  it('does not flag plugin skills — they live in a plugin-name:skill-name namespace', () => {
    const pluginSkill: SkillLintTarget = {
      id: 1,
      name: 'frontend-design',
      source_type: 'plugin',
      source_path: '/plugins/frontend-design',
      plugin_name: 'frontend-design@anthropic',
      description: 'Plugin copy',
      project_root: null,
      shadowed_by_skill_id: null
    }
    const globalSkill: SkillLintTarget = {
      id: 2,
      name: 'frontend-design',
      source_type: 'global',
      source_path: '/global/frontend-design',
      plugin_name: null,
      description: 'Personal copy',
      project_root: null,
      shadowed_by_skill_id: null
    }
    const context: LinterContext = {
      skills: [pluginSkill, globalSkill],
      globalMcpServers: new Set()
    }

    expect(nameCollisionRule.run(pluginSkill, context)).toEqual([])
    expect(nameCollisionRule.run(globalSkill, context)).toEqual([])
  })

  it('does not flag two same-named project skills in different repos', () => {
    const skillA: SkillLintTarget = {
      id: 1,
      name: 'visual-verify',
      source_type: 'project',
      source_path: '/repo-a/.claude/skills/visual-verify',
      plugin_name: null,
      description: 'A',
      project_root: '/repo-a',
      shadowed_by_skill_id: null
    }
    const skillB: SkillLintTarget = {
      id: 2,
      name: 'visual-verify',
      source_type: 'project',
      source_path: '/repo-b/.claude/skills/visual-verify',
      plugin_name: null,
      description: 'B',
      project_root: '/repo-b',
      shadowed_by_skill_id: null
    }
    const context: LinterContext = {
      skills: [skillA, skillB],
      globalMcpServers: new Set()
    }

    expect(nameCollisionRule.run(skillA, context)).toEqual([])
    expect(nameCollisionRule.run(skillB, context)).toEqual([])
  })
})
