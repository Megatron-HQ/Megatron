import type { LintRule, LintFindingInput } from '../types'
import { extractFrontmatterBlock, parseFrontmatterObject } from '../frontmatter'
import { accessSkillMd } from '../skill-md'

export const missingDescriptionRule: LintRule = {
  id: 'missing-description',
  name: 'Description Presence and Non-Empty Validation',
  run: (skill): LintFindingInput[] => {
    if (skill.source_type === 'plugin') {
      return []
    }

    const accessed = accessSkillMd(skill.source_path)
    if (accessed.status !== 'ok') return []

    const block = extractFrontmatterBlock(accessed.content)
    if (block === null) return []

    const parsed = parseFrontmatterObject(block)
    if (parsed === null) return []

    const rawDesc = parsed.description
    if (
      rawDesc === undefined ||
      rawDesc === null ||
      (typeof rawDesc === 'string' && rawDesc.trim() === '')
    ) {
      return [
        {
          skill_id: skill.id,
          rule_id: 'missing-description',
          severity: 'error',
          message: 'Missing or empty description',
          detail:
            'A non-empty description is required in YAML frontmatter for Claude Code auto-trigger matching',
          file_path: 'SKILL.md',
          line_number: 1
        }
      ]
    }

    return []
  }
}
