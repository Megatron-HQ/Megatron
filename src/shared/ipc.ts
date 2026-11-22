export const IPC_CHANNELS = {
  listSkills: 'skills:list',
  openSkill: 'skills:open',
  openSkillMeta: 'skills:openMeta',
  openSkillHistory: 'skills:openHistory',
  getInitialTheme: 'theme:getInitial',
  setTheme: 'theme:set',
  scanStarted: 'scan:started',
  scanComplete: 'scan:complete',
  scanProgress: 'scan:progress',
  listAllowedPaths: 'folders:list',
  listProjects: 'projects:list',
  pickAndAddFolders: 'folders:pickAndAdd',
  revokeAllowedPath: 'folders:revoke',
  narrowAllowedPath: 'folders:narrow',
  listHiddenProjects: 'folders:listHidden',
  hideProject: 'folders:hide',
  showProject: 'folders:show',
  openExternal: 'shell:openExternal',
  listPlugins: 'plugins:list',
  getPluginDetail: 'plugins:detail',
  enablePlugin: 'plugins:enable',
  disablePlugin: 'plugins:disable',
  updatePlugin: 'plugins:update',
  pluginUpdateProgress: 'plugins:updateProgress',
  uninstallPlugin: 'plugins:uninstall',
  listMcpServers: 'mcp:list',
  getMcpServerDetail: 'mcp:detail',
  revealMcpSource: 'mcp:revealSource',
  checkMcpConnections: 'mcp:checkConnections',
  getInitialMcpCheckConfirmed: 'mcp:getInitialCheckConfirmed',
  confirmMcpCheck: 'mcp:confirmCheck',
  removeMcpServer: 'mcp:remove',
  logoutMcpServer: 'mcp:logout',
  resetMcpProjectChoices: 'mcp:resetProjectChoices',
  getInitialSection: 'app:getInitialSection',
  setLastSection: 'app:setLastSection',
  getInitialOnboarding: 'app:getInitialOnboarding',
  setOnboardingDone: 'app:setOnboardingDone',
  getInitialWhatsNew: 'whatsNew:getInitial',
  markWhatsNewSeen: 'whatsNew:markSeen',
  clearWhatsNewDot: 'whatsNew:clearDot',
  rescan: 'app:rescan',
  revealDataFolder: 'app:revealDataFolder',
  getVersion: 'app:getVersion',
  getHomePath: 'app:getHomePath',
  usageOverview: 'usage:overview',
  usageCalendar: 'usage:calendar',
  usageDay: 'usage:day',
  usageProjects: 'usage:projects',
  usageLinkProjects: 'usage:projects:link',
  usageUnlinkProject: 'usage:projects:unlink',
  usageSkillInvocations: 'usage:skillInvocations',
  usageMcp: 'usage:mcp',
  usageContextBaseline: 'usage:contextBaseline',
  getInitialResidentTaxConfirmed: 'usage:getInitialResidentTaxConfirmed',
  confirmResidentTax: 'usage:confirmResidentTax',
  usageRecordedRequest: 'usage:recordedRequest',
  getUpdateState: 'updates:getState',
  checkForUpdates: 'updates:check',
  installUpdate: 'updates:install',
  setAutoUpdateCheck: 'updates:setAutoCheck',
  updateState: 'updates:state',
  getClaudeFolder: 'claudeFolder:get',
  chooseClaudeFolder: 'claudeFolder:choose',
  pickClaudeFolder: 'claudeFolder:pick',
  claudeFolderState: 'claudeFolder:state'
} as const

// Longer than any home-entry id (`home:` plus a folder name); the renderer only echoes ids main sent.
export const MAX_CLAUDE_FOLDER_ID_LENGTH = 300

export interface ClaudeFolderIssue {
  value: string
  // invalid: not an absolute local folder Megatron may read as a whole (relative, UNC, $HOME or an
  // ancestor, a drive root, a file, unreadable). missing: doesn't exist yet. no-marker: exists, but
  // Claude Code has never written to it. Only `missing` keeps the folder; the rest fall back.
  reason: 'invalid' | 'missing' | 'no-marker'
  source: 'settings' | 'environment'
}

// named: ~/.claude read with .claude.json inside it, as when CLAUDE_CONFIG_DIR names it, rather
// than as the default, which reads ~/.claude.json.
export type ClaudeFolderTag = 'default' | 'environment' | 'named'

export interface ClaudeFolderOption {
  // 'saved', 'default', 'named', 'environment' or `home:<name>`: the renderer chooses by id, never
  // by path.
  id: string
  path: string
  tags: ClaudeFolderTag[]
  active: boolean
}

export interface ClaudeFolderStatus {
  path: string
  source: 'default' | 'environment' | 'settings'
  // paused: the folder is gone, or came back failing the checks; scans and the CLI wait for it.
  state: 'ok' | 'paused' | 'switching'
  issue: ClaudeFolderIssue | null
  options: ClaudeFolderOption[]
}

export type ClaudeFolderChoice =
  | { outcome: 'canceled' }
  | { outcome: 'rejected'; path: string; reason: ClaudeFolderIssue['reason'] }
  | { outcome: 'chosen'; status: ClaudeFolderStatus }

// 'manual': a newer version exists but this install can't replace itself; detail says why.
export type UpdateStatus =
  'unsupported' | 'idle' | 'checking' | 'current' | 'downloading' | 'ready' | 'manual' | 'error'

export interface UpdateState {
  status: UpdateStatus
  version: string | null
  detail: string | null
  autoCheck: boolean
}

export interface AllowedPathRow {
  path: string
  granted_at: string
}

export interface SkippedGrant {
  path: string
  coveredBy: string
}

export interface GrantChangeResult {
  folders: AllowedPathRow[]
  skipped: SkippedGrant[]
}

// Shown in Manage Folders and as the native picker's macOS message, so both say the same thing.
export const GRANT_GUIDANCE =
  'A parent folder includes every project inside it, including ones added later. To include only some, select them individually; you can pick several at once.'

export interface ProjectFolder {
  path: string
  kind: 'folder' | 'repository'
  status: 'available' | 'unavailable' | 'missing' | 'needs_access'
}

// A git worktree (or Claude Code's .claude/worktrees layout) and the Canonical Checkout it
// belongs to; see CONTEXT.md.
export interface WorktreeLink {
  path: string
  canonical: string
}

export interface CanonicalCheckout {
  path: string
  // Filesystem identity of the approved common Git directory, when the filesystem supplies it.
  repository?: string
}

// What one Scan proved about Repos; main's Project Identity owner records it.
export interface RepoFindings {
  // Every Worktree link seen this pass, from either side; see CONTEXT.md "Worktree".
  worktrees: WorktreeLink[]
  // Positive discovery evidence; unlike catalog repositories, these are never stand-ins.
  canonicalCheckouts: CanonicalCheckout[]
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

// Not on SkillRow: staleness is computed at list time from the index plus the usage archive
// (docs/usage-analytics.md, Stale skills), and the detail payloads never carry it.
export interface InventorySkillRow extends SkillRow {
  stale: boolean
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

export interface ScanActivity {
  id: number
  startedAt: number
  // Only the launch scan may show app-wide progress; later refreshes stay silent.
  isStartup: boolean
  // How long this run stays quiet before the updating banner. A joined scan can only shorten it.
  revealMs: number
}

export interface ScanFinished {
  id: number
  summary: ScanSummary
}

export interface ScanSourceSummary {
  name: string
  status: 'complete' | 'partial' | 'failed'
  issues?: ScanIssue[]
  failureReason?: 'timeout' | 'worker_crash' | 'scan_error'
}

export type ScanWorkerProgress =
  | { type: 'source-started'; name: string }
  | {
      type: 'source-complete'
      source: ScanSourceSummary
      projects?: ProjectFolder[]
      findings?: RepoFindings
    }

export interface ScanProgress {
  id: number
  source: ScanSourceSummary
}

export interface SkillsListResult {
  skills: InventorySkillRow[]
  scanComplete: boolean
  scanSummary?: ScanSummary
  // Set while a scan is in progress so a renderer that missed scan:started can still time the banner.
  scanActivity: ScanActivity | null
  contextBudget: ContextBudget
  // Since when Uses and Last used count every use (usageHistorySince in known-calls.ts); null
  // before any transcript was seen.
  usesSince: string | null
}

export interface ScanIssue {
  code:
    | 'permission_required'
    | 'project_missing'
    | 'settings_invalid'
    | 'source_unavailable'
    | 'scan_limit'
    | 'link_unapproved'
  path: string
  // link_unapproved only: the folder the link at `path` resolves to.
  target?: string
}

export interface ScanTaskResult {
  status: 'complete' | 'partial'
  issues?: ScanIssue[]
  projects?: ProjectFolder[]
  findings?: RepoFindings
}

export interface ScanSummary {
  outcome: 'complete' | 'partial' | 'failed'
  completedAt: string
  sources: ScanSourceSummary[]
  isStartup?: boolean
  lastSuccessfulAt?: string | null
}

// What the worker hands main; main records `projects` and `findings`, then sends only the summary
// to the renderer.
export type ScanResult = ScanSummary & {
  projects?: ProjectFolder[]
  findings?: RepoFindings
  goneFolders?: string[]
}

export type FileStatus = 'ok' | 'too_large' | 'unreadable' | 'preview_limit'

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
  cwd: string // the session's cwd
  git_branch: string | null // NULL when cwd isn't a git repo, or its transcript is pruned
  agent_id: string | null // subagent filename stem; NULL for main-session invocations
  // 1 when only the usage archive still holds this use: Claude Code pruned its transcript, and
  // its prompt, args and branch went with it (preceding_user_text is then '').
  transcript_pruned: 0 | 1
}

export interface SkillInvocationRecord extends SkillInvocationEntry {
  skillName: string
  skillId: number | null
  sourceType: SourceType | null
}

export interface SkillInvocationSliceInput {
  startAt: string
  endAt: string
  skillName?: string
  offset?: number
}

export const INVOCATION_PAGE_SIZE = 200
export const MAX_INVOCATION_OFFSET = 10_000_000

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
  // Where the skill folder resolves when the folder itself is a link (Orca, `npx skills`).
  linkTarget: string | null
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
  // true when the registered project folder is granted and is not a directory. Distinct from
  // enablement_known: false caused by a missing grant, which still asks for folder access.
  project_missing: boolean
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

export type PluginComponentKind = 'agent' | 'command' | 'mcp' | 'hook' | 'lsp'

// One install's component, resolved from disk by Claude Code's own rules (docs/skill-scanner.md,
// Plugin components). Identity is (install_path, kind, name).
export interface PluginComponent {
  install_path: string
  kind: PluginComponentKind
  // Without the plugin prefix. Agents and commands keep their `:` subfolder segments.
  name: string
  // Agent/command description, MCP transport plus URL host or command basename (never args, env,
  // headers, or URL path/query), LSP file extensions. NULL for hooks.
  detail: string | null
  // The file that declares it; NULL only when nothing on disk does.
  source_path: string | null
}

export interface PluginDetailResult {
  plugin: PluginRow
  skills: SkillRow[]
  components: PluginComponent[]
  totalInvocations: number
  errorCount: number
  warningCount: number
}

export interface PluginActionResult {
  ok: boolean
  stderr?: string
  // Present after a focused post-update scan; avoids reading a second, potentially stale snapshot.
  detail?: PluginDetailResult | null
  verificationError?: string
}

export type PluginUpdatePhase = 'marketplace' | 'install' | 'verify'

export interface PluginUpdateProgress {
  input: PluginActionInput
  phase: PluginUpdatePhase
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
// docs/mcp-servers.md. One row per server however many places declare it; see CONTEXT.md, MCP.
export type McpServerKind = 'configured' | 'plugin' | 'connector' | 'observed'
export type McpTransport = 'stdio' | 'http' | 'sse' | 'ws'
export type McpDeclarationScope = 'local' | 'project' | 'user' | 'plugin'
export type McpConfigProblem = 'url_without_type' | 'unknown_type' | 'no_endpoint'
export type McpApproval = 'approved' | 'rejected' | 'pending'

// What `claude mcp list` reported, mapped from its own wording (docs/mcp-servers.md, Live check).
export type McpLiveStatus =
  | 'connected'
  | 'degraded'
  | 'needs_auth'
  | 'failed'
  | 'pending_approval'
  | 'rejected'
  | 'disabled'
  | 'not_configured'

export interface McpLiveServer {
  // As the CLI printed it: a configured name, plugin:<p>:<s>, or 'claude.ai <Name>'.
  name: string
  status: McpLiveStatus
}

// One run of `claude mcp list`, kept for the app session only. projectPath null: the general check,
// run from an empty folder, so only user servers, connectors, and user plugins appear.
export interface McpConnectionCheck {
  projectPath: string | null
  checkedAt: string
  servers: McpLiveServer[]
}

export type McpConnectionCheckResult =
  { ok: true; check: McpConnectionCheck } | { ok: false; error: string }

// A key Claude Code passes to the server; its value never leaves the main process.
export interface McpKeyName {
  name: string
  literal: boolean
}

// Longest a server id may be over IPC: plugin ids join a plugin and server name.
export const MAX_MCP_SERVER_ID_LENGTH = 1024

// MCP actions (docs/mcp-servers.md, Writes). The renderer names a Declaration by its server id,
// scope, and project; main takes the server's name from the index, never from the request.
export type McpConfiguredScope = 'local' | 'project' | 'user'

export interface McpDeclarationRef {
  serverId: string
  scope: McpConfiguredScope
  projectPath: string | null // null exactly for user scope
}

export interface McpProjectApprovals {
  approved: number
  pending: number
  rejected: number
}

// ok with message: the command ran and the index shows its effect. ok with verificationError: the
// command ran but the result isn't what was asked for, or couldn't be confirmed.
export type McpActionResult =
  | { ok: true; message: string }
  | { ok: true; verificationError: string }
  | { ok: false; error: string }

export interface McpServerRow {
  // configured:<name> | plugin:<plugin>:<server> | connector:<prefix> | observed:<prefix>
  id: string
  // As Claude Code names it: the configured name, plugin:<p>:<s>, or 'claude.ai <Name>'.
  name: string
  kind: McpServerKind
  // The sanitized part of its tools' names, mcp__<prefix>__<tool>.
  prefix: string
  transports: McpTransport[]
  location: string | null
  scopes: McpDeclarationScope[]
  projectCount: number
  // Projects with a local or project Declaration, or a project-scoped plugin install.
  projectPaths: string[]
  calls: number
  // Server errors only: refusals by the user's permission rules are counted in `denied`.
  errors: number
  denied: number
  // Calls whose prefix another server shares; credited to neither (docs/mcp-servers.md).
  ambiguousCalls: number
  lastUsedAt: string | null
  hasProblem: boolean
  hasLiteralCredential: boolean
  hasPendingApproval: boolean
  prefixCollision: boolean
  // Plugin rows: every install of the plugin is switched off.
  pluginDisabled: boolean
  // Lint findings by severity (docs/mcp-servers.md, Lint).
  warnings: number
  notices: number
  // From the last general connection check this session; null until one has run or included it.
  liveStatus: { status: McpLiveStatus; checkedAt: string } | null
}

export type McpLintSeverity = 'warning' | 'info'
export type McpLintRuleId =
  | 'mcp-inlined-credential'
  | 'mcp-pending-approval'
  | 'mcp-shadowed'
  | 'mcp-prefix-collision'
  | 'mcp-server-skipped'

// Derived from the index each time a server is read, so never stale and never stored.
export interface McpLintFinding {
  ruleId: McpLintRuleId
  severity: McpLintSeverity
  message: string
  // The Declaration it concerns; both null for a finding about the whole server.
  scope: McpDeclarationScope | null
  projectPath: string | null
}

export interface McpServerList {
  servers: McpServerRow[]
  // Since when every call is counted: the start of the latest unbroken transcript coverage
  // (known-calls.ts). Calls Megatron archived before then are still counted.
  callsSince: string | null
  lastCallAt: string | null
  // When the general connection check last ran this session.
  lastCheckedAt: string | null
}

// Where a declaration loses to a higher-precedence one. projectPath null: in every project.
export interface McpShadow {
  projectPath: string | null
  byScope: McpDeclarationScope
  byProjectPath: string | null
}

export interface McpDeclarationDetail {
  scope: McpDeclarationScope
  projectPath: string | null
  plugin: { name: string; marketplace: string } | null
  transport: McpTransport | null
  problem: McpConfigProblem | null
  location: string | null
  env: McpKeyName[]
  headers: McpKeyName[]
  argCount: number | null
  hasLiteralCredential: boolean
  approval: McpApproval | null
  sourcePath: string | null
  shadowedIn: McpShadow[]
}

export interface McpToolUsage {
  tool: string
  calls: number
  errors: number
  denied: number
  // Estimated from returned characters, like a Skill's token estimate.
  resultTokens: number
  resultImages: number
  lastUsedAt: string | null
}

export interface McpServerDetail {
  server: McpServerRow
  declarations: McpDeclarationDetail[]
  // Projects whose /mcp switch turned this server off; '' is never listed.
  disabledIn: string[]
  // Connector rows: where disableClaudeAiConnectors applies. '' means user settings, so everywhere.
  connectorsDisabledIn: string[]
  tools: McpToolUsage[]
  findings: McpLintFinding[]
  // Per-project connection checks this session that included this server.
  projectStatuses: { projectPath: string; status: McpLiveStatus; checkedAt: string }[]
  // Tool-definition tokens from the last /context run this launch; null until one has run.
  definitionTokens: { tokens: number; measuredAt: string } | null
}

export const APP_SECTIONS = ['skills', 'plugins', 'mcp', 'usage'] as const
export type AppSection = (typeof APP_SECTIONS)[number]

export const SETTINGS_PANES = ['general', 'claude-code', 'updates', 'about'] as const
export type SettingsPane = (typeof SETTINGS_PANES)[number]

export interface ActivityProjectCount {
  project: string // raw cwd in reducers; primary project location in Usage IPC
  count: number
}

// Usage → MCP servers: one server's calls in a window (docs/mcp-servers.md, Usage panel).
export interface McpUsageServerRow {
  id: string // McpServerRow.id, the detail's key
  name: string
  kind: McpServerKind
  calls: number
  errors: number // refusals excluded
  denied: number
  // errors / calls that weren't refused; null when every call was refused.
  errorRate: number | null
  resultTokens: number // estimated from returned characters
}

export interface McpUsageWindow {
  window: SkillStatsWindowKey
  startAt: string
  endAt: string
  calls: number // includes calls on a shared prefix, which no server is credited with
  errors: number
  denied: number
  resultTokens: number
  serverCount: number
  sessionCount: number
  ambiguousCalls: number
  trend: SkillTrendBucket[]
  byServer: McpUsageServerRow[]
  byProject: ActivityProjectCount[] // grouped by Usage project
}

export interface McpUsageStats {
  // The oldest call the index holds, for the label naming how far back transcripts reach.
  firstCallAt: string | null
  last24h: McpUsageWindow
  last7d: McpUsageWindow
  last30d: McpUsageWindow
}

// One bar's drill-down, precomputed in the overview payload like CostDay/CostHour.
export interface ActivityBucketDetails {
  coverage?: HistoryCoverage
  startAt: string // clipped, inclusive ISO boundary
  endAt: string // clipped ISO boundary
  count: number // prompts, excluding bare slash commands
  sessions: number // distinct sessions with at least one prompt
  slashCommands: number
  byProject: ActivityProjectCount[] // count desc
}

export interface ActivityDay extends ActivityBucketDetails {
  date: string // YYYY-MM-DD, local time
  weekday: number // 0 = Sunday, server-computed so the renderer never re-parses `date`
  partial: boolean // the rolling window cuts into this date
}

export interface ActivityHour extends ActivityBucketDetails {
  key: string // ISO start of a rolling one-hour bucket
}

export interface ActivityWindow {
  coverage?: HistoryCoverage
  days: 1 | 7 | 30
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

export interface Activity24HourWindow extends ActivityWindow {
  days: 1
  hourlyTrend: ActivityHour[] // 24 zero-filled rolling buckets, ascending
}

export interface ActivityStats {
  last24h: Activity24HourWindow
  last7d: ActivityWindow
  last30d: ActivityWindow
  generatedAt: string
}

// The Cost section (docs/usage-analytics.md). Read verbatim from Claude Code's per-session
// `cost-state` remains the dollar source. Rolling windows use its proportional activity-time
// shares; coverage metadata describes all retained priced terminal sessions.
export type CostWindowKey = '24h' | '7d' | '30d'
export const UNATTRIBUTED_COST_MODEL = 'unattributed'
export interface CostModelSpend {
  model: string // normalized key (date suffix stripped) — formatModelName / modelSeriesVar assume this
  costUsd: number
}

export interface CostProjectSpend {
  project: string // raw cwd in reducers; primary project location in Usage IPC
  costUsd: number
}

export interface CostDay {
  date: string // YYYY-MM-DD, local time
  costUsd: number
  weekday: number // 0 = Sunday, server-computed
  startAt: string // clipped, inclusive ISO boundary
  endAt: string // clipped, exclusive ISO boundary
  partial: boolean
  pricedSessionCount: number
  hasUnknownModelCost: boolean
  hasEstimatedCost: boolean
  byModel: CostModelSpend[]
  byProject: CostProjectSpend[]
}

export interface CostHour {
  startAt: string
  endAt: string
  costUsd: number
  pricedSessionCount: number
  hasUnknownModelCost: boolean
  hasEstimatedCost: boolean
  byModel: CostModelSpend[]
  byProject: CostProjectSpend[]
}

export interface CostWindow {
  days: 1 | 7 | 30
  startAt: string
  endAt: string
  totalCostUsd: number
  pricedSessionCount: number // distinct priced terminals contributing timestamped shares
  hasUnknownModelCost: boolean
  // A contributing fork lineage lost a shared ancestor to Claude Code's cleanup, so its cost is
  // the head's own counter rather than the exact branch sum.
  hasEstimatedCost: boolean
  byModel: CostModelSpend[]
  byProject: CostProjectSpend[]
  byDay: CostDay[] // all local dates intersecting the rolling window, zero-filled
  byHourChronological: CostHour[] // exactly 24 entries for 24h, empty for longer windows
  byHourWeekday: number[][] // local [weekday][hour], Sunday = 0
  byHour: number[] // matrix column totals
  byWeekday: number[] // matrix row totals
}

export interface CostStats {
  trackedSince: string
  totalTrackedCostUsd: number
  pricedSessionCount: number
  preTrackingSessionCount: number
  unusableSessionCount: number
  undatedCostUsd: number // retained cost without activity timestamps, excluded from windows
  undatedSessionCount: number
  last24h: CostWindow
  last7d: CostWindow
  last30d: CostWindow
}

export type SkillStatsWindowKey = '24h' | '7d' | '30d'
export type RecordedEffort = 'xhigh' | 'high' | 'medium' | 'low'
export type EffortBucket = RecordedEffort | 'not_recorded'

export interface ModelTurnSummary {
  model: string
  turnCount: number
  outputTokens: number
}

export interface EffortTurnSummary {
  effort: EffortBucket
  turnCount: number
  outputTokens: number
}

export interface ModelEffortRow {
  model: string
  byEffort: Record<EffortBucket, number>
  total: number
}

export interface ModelStatsWindow {
  window: SkillStatsWindowKey
  turnCount: number
  modelCount: number
  outputTokens: number
  byModel: ModelTurnSummary[]
  byEffort: EffortTurnSummary[]
  matrix: ModelEffortRow[]
}

export interface ModelStats {
  last24h: ModelStatsWindow
  last7d: ModelStatsWindow
  last30d: ModelStatsWindow
}

export interface SkillInvocationCount {
  skillName: string
  count: number
  sourceType: SourceType | null
  skillId: number | null
  resolution: 'installed' | 'ambiguous' | 'missing'
}

export interface SkillTrendBucket {
  key: string // ISO hour start for 24h; YYYY-MM-DD local date for 7d/30d
  count: number
  startAt: string // inclusive, clipped to the rolling window
  endAt: string // exclusive, clipped to the overview snapshot
}

export interface SkillCostAssociation {
  skillName: string
  // Resolved skills row (global > project > synced precedence) — the click-through target.
  // null = no matching skills row (uninstalled / renamed / plugin-not-installed / leaked
  // built-in like `run`); the row renders without click-through.
  skillId: number | null
  sourceType: SourceType | null
  sessionCount: number
  trackedSessionCount: number
  associatedCostUsd: number
  associatedOutputTokens: number
}

export interface SkillStatsWindow {
  window: SkillStatsWindowKey
  startAt: string
  endAt: string
  invocationCount: number
  unpricedInvocationCount: number
  skillCount: number
  sessionCount: number
  bySkill: SkillInvocationCount[]
  byTriggerType: TriggerTypeCount[]
  trend: SkillTrendBucket[]
  associations: SkillCostAssociation[]
  attribution: SkillCostAttribution
}

export interface SkillStats {
  last24h: SkillStatsWindow
  last7d: SkillStatsWindow
  last30d: SkillStatsWindow
  // Priced, lineage-terminal sessions that no skill invocation resolves to — for the Skills
  // caption. Spans all cost-tracked history, NOT the selected window. Cost's displayed
  // totals are independently windowed; this Skills coverage caption remains dataset-wide.
  pricedSessionsWithoutSkill: number
}

export interface SkillCostAttributionRow {
  skillName: string | null // null = General work
  skillId: number | null
  sourceType: SourceType | null
  trackedSessionCount: number
  estimatedCostCents: number
  share: number
  resolution: 'installed' | 'ambiguous' | 'missing' | 'general'
}

export interface SkillCostAttribution {
  totalEstimatedCostCents: number
  trackedSessionCount: number
  hasUnknownModelCost: boolean
  hasUndatedCost: boolean
  rows: SkillCostAttributionRow[]
}

// Resident tax (docs/usage-analytics.md): Claude Code's own `/context` breakdown, parsed
// generically so a category Claude Code adds later passes through instead of being dropped.
export type ContextCategoryGroup = 'used' | 'deferred' | 'buffer' | 'free'

export interface ContextCategory {
  name: string
  display: string // as /context printed it, e.g. "1.8k"
  tokens: number
  group: ContextCategoryGroup
}

export interface ContextSectionRow {
  cells: string[]
  // Parsed from the Tokens column for sorting only; "< 20" parses to its bound. Display the cell.
  tokens: number | null
}

export interface ContextSection {
  title: string
  columns: string[]
  rows: ContextSectionRow[]
}

export interface ContextUsage {
  model: string
  totalDisplay: string
  totalTokens: number
  windowDisplay: string
  windowTokens: number
  percentDisplay: string
  categories: ContextCategory[]
  sections: ContextSection[]
}

export type ContextBaselineResult =
  | { ok: true; usage: ContextUsage; measuredAt: string }
  // raw: Claude Code's unparsed output, so a format change still shows the user something.
  | { ok: false; error: string; raw?: string }

// The first request of the newest interactive session, read from its transcript on demand and
// never stored (docs/usage-analytics.md, Resident tax). Sizes are exact characters; Megatron doesn't estimate
// tokens for these — only /context's own per-item tokens are shown as tokens.
export interface RecordedCacheControl {
  ttl: string | null
  scope: string | null
}

export interface RecordedSystemBlock {
  text: string
  chars: number
  cacheControl: RecordedCacheControl | null
}

export interface RecordedTool {
  name: string
  chars: number
  definitionJson: string
  isMcp: boolean
}

export interface RecordedCacheBreakpoint {
  path: string // e.g. "system[1]", "messages[1].content[3]"
  cacheControl: RecordedCacheControl
}

export interface RecordedTextBlock {
  name: string
  text: string
  chars: number
}

export interface RecordedRequest {
  sessionId: string
  cwd: string | null
  claudeVersion: string
  requestedAt: string
  model: string | null
  systemBlocks: RecordedSystemBlock[]
  tools: RecordedTool[]
  cacheBreakpoints: RecordedCacheBreakpoint[]
  hookOutputs: RecordedTextBlock[]
  mcpInstructions: RecordedTextBlock[]
}

export interface UsageOverview {
  tokens: TokenStats
  activity: ActivityStats
  // null iff pricedSessionCount === 0 — no session has usable cost-state.
  cost: CostStats | null
  models: ModelStats
  skills: SkillStats
  scanComplete: boolean
  scanSummary?: ScanSummary
}

export interface TokenCounts {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  total: number
}

export interface TokenBreakdown {
  key: string
  tokens: TokenCounts
}

export interface TokenBucket {
  key: string
  startAt: string
  endAt: string
  // Daily bucket clipped by the rolling window; always false for hourly buckets.
  partial: boolean
  tokens: TokenCounts | null
  byModel: TokenBreakdown[]
  byProject: TokenBreakdown[]
}

export interface TokenWindow {
  startAt: string
  endAt: string
  tokens: TokenCounts | null
  byModel: TokenBreakdown[]
  byProject: TokenBreakdown[]
  trend: TokenBucket[]
}

export interface TokenStats {
  last24h: TokenWindow
  last7d: TokenWindow
  last30d: TokenWindow
  missingSessionCount: number
  undatedTokens: TokenCounts
}

export type HistoryCoverage = 'available' | 'partial' | 'unavailable' | 'future'

export interface ContributionDay {
  date: string
  weekday: number
  count: number
  coverage: HistoryCoverage
  tokens: TokenCounts | null
}

export interface HistoryYearSummary {
  observedDays: number
  partialDays: number
  elapsedDays: number
  longestStreak: { days: number; startDate: string; endDate: string } | null
  busiestDay: { date: string; count: number } | null
  promptsPerActiveDay: number | null
}

export interface HistoryMonth {
  month: number
  count: number
  coverage: HistoryCoverage
}

export interface HistoryProject {
  project: string
  total: number
  byMonth: number[]
}

export interface UsageCalendar {
  year: number
  years: number[]
  days: ContributionDay[]
  thresholds: number[]
  prompts: number
  activeDays: number
  summary: HistoryYearSummary
  months: HistoryMonth[]
  byProject: HistoryProject[]
}

export interface UsageDayDetails extends ActivityDay {
  coverage: HistoryCoverage
  tokens: TokenCounts | null
}
