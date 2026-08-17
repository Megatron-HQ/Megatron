import { parse } from 'yaml'
import type { LintRule, LintFindingInput } from '../types'
import { extractFrontmatterBlock } from '../frontmatter'
import { accessSkillMd } from '../skill-md'

export const yamlFrontmatterRule: LintRule = {
  id: 'yaml-frontmatter',
  name: 'YAML Frontmatter Validation',
  run: (skill): LintFindingInput[] => {
    if (skill.source_type === 'plugin') {
      return []
    }

    const accessed = accessSkillMd(skill.source_path)
    if (accessed.status === 'denied') return []
    if (accessed.status === 'missing') {
      return [
        {
          skill_id: skill.id,
          rule_id: 'yaml-frontmatter',
          severity: 'error',
          message: 'Missing SKILL.md or frontmatter block',
          detail: 'No SKILL.md file found in skill directory',
          file_path: 'SKILL.md',
          line_number: 1
        }
      ]
    }
    if (accessed.status === 'unreadable') {
      return [
        {
          skill_id: skill.id,
          rule_id: 'yaml-frontmatter',
          severity: 'error',
          message: 'Unreadable SKILL.md file',
          detail: 'SKILL.md exists but could not be read',
          file_path: 'SKILL.md',
          line_number: 1
        }
      ]
    }

    const block = extractFrontmatterBlock(accessed.content)
    if (block === null) {
      return [
        {
          skill_id: skill.id,
          rule_id: 'yaml-frontmatter',
          severity: 'error',
          message: 'Missing frontmatter block',
          detail: 'SKILL.md must begin with a YAML frontmatter block enclosed in --- delimiters',
          file_path: 'SKILL.md',
          line_number: 1
        }
      ]
    }

    try {
      const parsed = parse(block)
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return [
          {
            skill_id: skill.id,
            rule_id: 'yaml-frontmatter',
            severity: 'error',
            message: 'Malformed YAML frontmatter',
            detail: 'Frontmatter must be a YAML object mapping',
            file_path: 'SKILL.md',
            line_number: 1
          }
        ]
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Invalid YAML syntax'
      return [
        {
          skill_id: skill.id,
          rule_id: 'yaml-frontmatter',
          severity: 'error',
          message: 'Malformed YAML frontmatter',
          detail: message,
          file_path: 'SKILL.md',
          line_number: 1
        }
      ]
    }

    return []
  }
}
