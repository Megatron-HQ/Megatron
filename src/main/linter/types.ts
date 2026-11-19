import type { LintSeverity, SourceType } from '../../shared/ipc'
import type { KnownMcpPrefixes } from '../db/mcp-queries'

export interface LintFindingInput {
  skill_id: number
  rule_id: string
  severity: LintSeverity
  message: string
  detail?: string | null
  file_path?: string | null
  line_number?: number | null
}

export interface SkillLintTarget {
  id: number
  name: string
  source_type: SourceType
  source_path: string
  plugin_name: string | null
  description: string | null
  project_root?: string | null
  shadowed_by_skill_id?: number | null
}

export interface LinterContext {
  skills: SkillLintTarget[]
  // From the index's MCP servers (docs/mcp-servers.md), never read from config files here.
  mcpPrefixes: KnownMcpPrefixes
}

export interface LintRule {
  id: string
  name: string
  run: (skill: SkillLintTarget, context: LinterContext) => LintFindingInput[]
}
