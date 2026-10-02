import type Database from 'better-sqlite3'
import { listSkills, replaceAllLintFindings, type InsertLintFindingInput } from '../db/queries'
import { getGlobalMcpServers } from './mcp-config'
import type { LintRule, LinterContext, SkillLintTarget } from './types'
import { yamlFrontmatterRule } from './rules/yaml-frontmatter'
import { missingDescriptionRule } from './rules/missing-description'
import { brokenFilePathsRule } from './rules/broken-file-paths'
import { missingMcpServersRule } from './rules/missing-mcp-servers'
import { nameCollisionRule } from './rules/name-collision'
import { readAllowedFile } from '../permissions'
import { join } from 'path'
import type { ScanTaskResult } from '../../shared/ipc'

export const RULES: LintRule[] = [
  yamlFrontmatterRule,
  missingDescriptionRule,
  brokenFilePathsRule,
  missingMcpServersRule,
  nameCollisionRule
]

export function runLinter(db: Database.Database): ScanTaskResult {
  const preservedSkillIds: number[] = []
  let partial = false
  const rawSkills = listSkills(db)
  const skills: SkillLintTarget[] = rawSkills.map((s) => ({
    id: s.id,
    name: s.name,
    source_type: s.source_type,
    source_path: s.source_path,
    plugin_name: s.plugin_name,
    description: s.description,
    project_root: s.project_root,
    shadowed_by_skill_id: s.shadowed_by_skill_id
  }))

  const globalMcpServers = getGlobalMcpServers()
  const context: LinterContext = {
    skills,
    globalMcpServers
  }

  const allFindings: (InsertLintFindingInput & { skill_id: number })[] = []

  for (const skill of skills) {
    const read = readAllowedFile(join(skill.source_path, 'SKILL.md'))
    if (read.status !== 'ok' && read.status !== 'missing') {
      preservedSkillIds.push(skill.id)
      partial = true
      continue
    }
    const skillFindings: (InsertLintFindingInput & { skill_id: number })[] = []
    let ruleFailed = false
    for (const rule of RULES) {
      try {
        const findings = rule.run(skill, context)
        for (const f of findings) {
          skillFindings.push({
            skill_id: skill.id,
            rule_id: f.rule_id,
            severity: f.severity,
            message: f.message,
            detail: f.detail,
            file_path: f.file_path,
            line_number: f.line_number
          })
        }
      } catch (err) {
        ruleFailed = true
        partial = true
        console.error(`[Linter] Error running rule ${rule.id} on ${skill.name}:`, err)
      }
    }
    if (ruleFailed) preservedSkillIds.push(skill.id)
    else allFindings.push(...skillFindings)
  }

  replaceAllLintFindings(db, allFindings, preservedSkillIds)
  return { status: partial ? 'partial' : 'complete' }
}

export * from './types'
export * from './mcp-config'
