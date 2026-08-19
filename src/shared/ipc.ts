export const IPC_CHANNELS = {
  listSkills: 'skills:list',
  openSkill: 'skills:open',
  openSkillMeta: 'skills:openMeta',
  getInitialTheme: 'theme:getInitial',
  setTheme: 'theme:set',
  scanComplete: 'scan:complete',
  listAllowedPaths: 'folders:list',
  pickAndAddFolders: 'folders:pickAndAdd',
  revokeAllowedPath: 'folders:revoke',
  openExternal: 'shell:openExternal'
} as const

export interface AllowedPathRow {
  path: string
  granted_at: string
}

export type SourceType = 'global' | 'project' | 'plugin'
export type LintSeverity = 'error' | 'warning'
export type LintStatus = 'error' | 'warning' | 'clean'

export interface LintFindingRow {
  id: number
  skill_id: number
  rule_id: string
  severity: LintSeverity
  message: string
  detail: string | null
  file_path: string | null
  line_number: number | null
  detected_at: string
}

export type TriggerType = 'user_invoked' | 'autonomous' | 'subagent'

export interface SkillRow {
  id: number
  name: string
  source_type: SourceType
  source_path: string
  plugin_name: string | null
  description: string | null
  last_scanned_at: string
  est_listing_tokens: number
  est_body_tokens: number
  project_root: string | null
  metadata_json: string | null // frontmatter `metadata:` block, JSON as stored
  modified_at: string | null // SKILL.md mtime; NULL for plugin skills
  // 1 for a global skill found under the reserved synced/ folder (claude.ai sync); 0 otherwise.
  is_synced: number
  total_invocations: number
  last_invoked_at: string | null
  // Non-null only for a project skill that's permanently shadowed by a global skill of the
  // same name (global always wins — see queries.ts). Points at the global skill's id.
  shadowed_by_skill_id: number | null
  lint_status: LintStatus
  error_count: number
  warning_count: number
}

export interface ContextBudget {
  used: number
  limit: number
}

export interface SkillsListResult {
  skills: SkillRow[]
  scanComplete: boolean
  contextBudget: ContextBudget
}

export type FileStatus = 'ok' | 'too_large' | 'unreadable'

export interface SkillFile {
  relativePath: string
  content: string | null
  status: FileStatus
}

export interface TriggerTypeCount {
  trigger_type: TriggerType
  count: number
}

export interface ProjectCount {
  cwd: string
  count: number
}

export interface RecentTrigger {
  preceding_user_text: string
  invoked_at: string
  trigger_type: TriggerType
}

export interface SkillUsageDetail {
  byTriggerType: TriggerTypeCount[]
  byProject: ProjectCount[]
  recentTriggers: RecentTrigger[]
}

export interface OpenSkillResult {
  skill: SkillRow
  files: SkillFile[]
  usage: SkillUsageDetail
  findings: LintFindingRow[]
}

export interface OpenSkillMetaResult {
  skill: SkillRow
  usage: SkillUsageDetail
  skillMdContent: string | null
  findings: LintFindingRow[]
}

export type Theme = 'light' | 'dark'
