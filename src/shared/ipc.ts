export const IPC_CHANNELS = {
  listSkills: 'skills:list',
  openSkill: 'skills:open',
  openSkillMeta: 'skills:openMeta',
  openSkillHistory: 'skills:openHistory',
  getInitialTheme: 'theme:getInitial',
  setTheme: 'theme:set',
  scanComplete: 'scan:complete',
  listAllowedPaths: 'folders:list',
  pickAndAddFolders: 'folders:pickAndAdd',
  revokeAllowedPath: 'folders:revoke',
  openExternal: 'shell:openExternal',
  listPlugins: 'plugins:list',
  getPluginDetail: 'plugins:detail',
  enablePlugin: 'plugins:enable',
  disablePlugin: 'plugins:disable',
  updatePlugin: 'plugins:update',
  uninstallPlugin: 'plugins:uninstall',
  getInitialSection: 'app:getInitialSection',
  setLastSection: 'app:setLastSection',
  rescan: 'app:rescan',
  revealDataFolder: 'app:revealDataFolder',
  getVersion: 'app:getVersion',
  usageOverview: 'usage:overview'
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
  // JSON array of hook event names from the plugin's declared hooks manifest; NULL for
  // global/project skills and for plugin skills whose plugin declares no hooks.
  hook_events: string | null
  // NULL when enabled. 'plugin' when the owning plugin is disabled (enabledPlugins: false —
  // Claude Code unloads the whole plugin). 'override' when settings.json's skillOverrides has
  // this skill set to "off" (plugin skills can't carry this one, only 'plugin' applies to them).
  disabled_reason: string | null
  // 0 when Claude Code keeps this skill's description out of its skill listing (user-invocable
  // only — set by frontmatter `disable-model-invocation: true` or settings.json skillOverrides
  // `<name>: user-invocable-only`), so it costs 0 listing tokens. The skill still runs via /name.
  model_invocable: number
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
  // Sum of est_listing_tokens, and count, of global/plugin skills excluded from `used`
  // because disabled_reason is set — the audit line under the budget in ContextBudgetDialog.
  excludedTokens: number
  excludedCount: number
  // Same, for skills excluded because model_invocable = 0 (user-invocable only — Claude Code
  // keeps their descriptions out of the listing). Mutually exclusive with excluded*: a skill
  // that is both counts only under excluded*.
  userInvocableOnlyTokens: number
  userInvocableOnlyCount: number
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

// One row of a skill's invocation history — serves both the recent-five list on the detail
// page and the full lifetime log behind SkillActivityDialog, hence the source-neutral name.
export interface SkillInvocationEntry {
  preceding_user_text: string
  invoked_at: string
  trigger_type: TriggerType
  cwd: string // from sessions_meta
  git_branch: string | null // NULL when cwd isn't a git repo
  agent_id: string | null // subagent filename stem; NULL for main-session invocations
}

export interface SkillUsageDetail {
  byTriggerType: TriggerTypeCount[]
  byProject: ProjectCount[]
  // The recent five, specifically — the full log comes from openSkillHistory.
  recentTriggers: SkillInvocationEntry[]
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
export type ThemePreference = Theme | 'system'

// 'project' is the repo's committed .claude/settings.json; 'local' is that developer's own
// .claude/settings.local.json. Both are anchored to a project root; 'user' never is.
export type PluginScope = 'user' | 'project' | 'local'

export interface PluginInstall {
  scope: PluginScope
  install_path: string
  installed_at: string | null
  last_updated: string | null
  git_commit_sha: string | null
  // Owning project root for a project/local install; NULL for user scope, and also for a
  // project/local entry that Claude Code wrote without a projectPath.
  project_path: string | null
  // Per-install, because two scopes of one plugin can be installed at different versions.
  installed_version: string
  // Per-install, resolved against this install's own scope: a plugin can be enabled for a
  // project and disabled at user scope, or the reverse.
  disabled_reason: string | null
  // Latest version available on the marketplace for this install; NULL if unresolvable.
  available_version: string | null
  // false when this install's enabled/disabled state could not be determined — a project/local
  // install whose owning project root has not been granted, so its .claude/settings*.json is
  // unreadable. Renders as an Unknown status rather than a confidently wrong Enabled.
  enablement_known: boolean
}

export interface PluginRow {
  name: string
  marketplace: string
  marketplace_repo: string | null
  // Highest version across installs. Installs can disagree, so the inventory reads
  // installs[].installed_version to decide whether to show this or "Mixed".
  installed_version: string
  // Latest version available on the marketplace; NULL if unresolvable.
  available_version: string | null
  // Identity-level rollup meaning disabled *everywhere* — non-null only when every install is
  // disabled. Per-install state lives on installs[].disabled_reason.
  disabled_reason: string | null
  skill_count: number
  installs: PluginInstall[]
}

export interface PluginDetailResult {
  plugin: PluginRow
  skills: SkillRow[]
  totalInvocations: number
  errorCount: number
  warningCount: number
}

export interface PluginActionResult {
  ok: boolean
  stderr?: string
}

export interface PluginActionInput {
  name: string
  marketplace: string
  scope: PluginScope
  // The install's owning project root, used as the CLI's working directory — that's how
  // `claude plugin <verb>` resolves a project/local install. Always null for user scope.
  projectPath: string | null
}

// The runtime list resolveInitialSection validates a stored value against, plus the derived
// union — one source so the two can't drift.
export const APP_SECTIONS = ['skills', 'plugins', 'usage'] as const
export type AppSection = (typeof APP_SECTIONS)[number]

export interface ActivityProjectCount {
  project: string // raw cwd string, matches sessions_meta.cwd
  count: number
}

export interface ActivityDay {
  date: string // YYYY-MM-DD, local time
  count: number
  weekday: number // 0 = Sunday, server-computed so the renderer never re-parses `date`
}

export interface ActivityWindow {
  days: 7 | 30
  activeDays: number
  sessions: number
  prompts: number
  slashCommands: number
  byHour: number[] // length 24, local time
  byWeekday: number[] // length 7, index 0 = Sunday, local time
  // 7 rows × 24 cols, [weekday][hour], row 0 = Sunday, local time — the punchcard.
  // byHour / byWeekday are its margins, summed out of it and kept for reuse.
  byHourWeekday: number[][]
  byProject: ActivityProjectCount[] // full list, count desc
  byDay: ActivityDay[] // zero-filled, ascending
}

export interface ActivityStats {
  last7d: ActivityWindow
  last30d: ActivityWindow
  generatedAt: string
}

// The Cost section (docs/usage-view-ui-spec.md §C). Read verbatim from Claude Code's per-session
// `cost-state` line — an "estimated API-equivalent cost", never a charge. Spans the entire
// cost-tracked window (self-bounding via the transcript prune); ignores the 7d/30d toggle.
export interface CostModelSpend {
  model: string // normalized key (date suffix stripped) — formatModelName / modelSeriesVar assume this
  costUsd: number
}

export interface CostProjectSpend {
  project: string // raw cwd path, matches sessions_meta.cwd
  costUsd: number
}

export interface CostDay {
  date: string // YYYY-MM-DD, local time
  costUsd: number
  weekday: number // 0 = Sunday, server-computed
}

export interface CostStats {
  trackedSince: string // ISO — MIN(started_at) over priced, lineage-terminal sessions
  totalCostUsd: number
  pricedSessionCount: number // priced, lineage-terminal sessions — "Covers N sessions since {date}"
  preTrackingSessionCount: number // started_at < trackedSince — pure date cut
  unusableSessionCount: number // started_at >= trackedSince but no usable cost row (zeroed + crashes)
  hasUnknownModelCost: boolean // some priced terminal ran a model Claude Code couldn't price
  byModel: CostModelSpend[] // desc by cost, model-name tie-break
  byProject: CostProjectSpend[] // desc by cost, cwd tie-break
  byDay: CostDay[] // zero-filled, trackedSince → today, ascending
}

export type SkillStatsWindowKey = '24h' | '7d' | '30d'

export interface SkillInvocationCount {
  skillName: string
  count: number
}

export interface SkillTrendBucket {
  key: string // ISO hour start for 24h; YYYY-MM-DD local date for 7d/30d
  count: number
}

export interface SkillCostAssociation {
  skillName: string
  sessionCount: number
  trackedSessionCount: number
  associatedCostUsd: number
  associatedOutputTokens: number
}

export interface SkillStatsWindow {
  window: SkillStatsWindowKey
  invocationCount: number
  skillCount: number
  sessionCount: number
  bySkill: SkillInvocationCount[]
  byTriggerType: TriggerTypeCount[]
  trend: SkillTrendBucket[]
  associations: SkillCostAssociation[]
}

export interface SkillStats {
  last24h: SkillStatsWindow
  last7d: SkillStatsWindow
  last30d: SkillStatsWindow
}

export interface UsageOverview {
  activity: ActivityStats
  // null iff pricedSessionCount === 0 — no session has usable cost-state.
  cost: CostStats | null
  skills: SkillStats
  scanComplete: boolean
}
