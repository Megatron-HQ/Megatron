import type { LintRule, LintFindingInput } from '../types'

export const nameCollisionRule: LintRule = {
  id: 'name-collision',
  name: 'Skill Name Collision',
  run: (skill): LintFindingInput[] => {
    if (skill.source_type === 'plugin') return []
    if (skill.shadowed_by_skill_id == null) return []

    return [
      {
        skill_id: skill.id,
        rule_id: 'name-collision',
        severity: 'warning',
        message: `Project skill "${skill.name}" is shadowed by a global skill of the same name`,
        detail: `Claude Code always prefers the personal (global) skill. This project skill can never run while the global "${skill.name}" exists.`,
        file_path: 'SKILL.md',
        line_number: 1
      }
    ]
  }
}
