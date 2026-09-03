import type Database from 'better-sqlite3'
import { dirname, join, resolve, sep } from 'path'
import { CHARS_PER_TOKEN } from '../ingest/skill-parser'
import type {
  AllowedPathRow,
  ContextBudget,
  LintFindingRow,
  LintSeverity,
  PluginDetailResult,
  PluginInstall,
  PluginRow,
  ProjectCount,
  SkillInvocationEntry,
  SkillRow,
  SkillUsageDetail,
  SourceType,
  TriggerTypeCount
} from '../../shared/ipc'

const PROJECT_PATH_SEPARATORS = [...new Set([sep, '/', '\\'])]

function projectPathScopeSql(cwdExpression: string, rootExpression: string): string {
  const nestedPathChecks = PROJECT_PATH_SEPARATORS.map(
    (separator) =>
      `substr(${cwdExpression}, 1, length(${rootExpression}) + 1) = ${rootExpression} || '${separator}'`
  ).join(' OR ')
  return `(${cwdExpression} = ${rootExpression} OR ${nestedPathChecks})`
}

const SKILL_PROJECT_PATH_SCOPE = projectPathScopeSql('sm.cwd', 's.project_root')
const PARAMETERIZED_PROJECT_PATH_SCOPE = projectPathScopeSql('sm.cwd', '@root')

// Live aggregate, not a stored count — skill_invocations is append-only and joined by
// skill_name (no FK, per the locked no-FK decision), so this can never fall out of sync.
//
// Precedence rule (verified against code.claude.com/docs/en/skills): personal/global always
// overrides a same-named project skill, everywhere, unconditionally — so a shadowed project
// skill can never actually have fired. Its count is forced to 0 rather than left to a bare
// name join, which would otherwise credit it with invocations that really ran the global one.
// A non-shadowed project skill is scoped to sessions whose cwd is under its own project_root
// (`substr`, not `LIKE` — `_`/`%` in a real path are literal characters, not wildcards) so two
// different repos with a same-named skill don't inflate each other's counts. Global/plugin
// skills stay unscoped by name: global wins everywhere, and plugin skills are namespaced
// (`plugin-name:skill-name`) so they structurally cannot collide with anything.
const SKILLS_WITH_USAGE_SELECT = `
  WITH s AS (
    SELECT
      skills.*,
      COALESCE(
        (
          SELECT g.id FROM skills g
          WHERE g.source_type = 'global' AND g.name = skills.name AND skills.source_type = 'project'
          LIMIT 1
        ),
        (
          -- Synced skills are the lowest-priority source (docs/skill-scanner.md): any
          -- non-synced skill of the same name — global or project — outranks them.
          SELECT ns.id FROM skills ns
          WHERE ns.name = skills.name AND ns.is_synced = 0 AND skills.is_synced = 1
          LIMIT 1
        )
      ) AS shadowed_by_skill_id
    FROM skills
  )
  SELECT
    s.id, s.name, s.source_type, s.source_path, s.plugin_name, s.description,
    s.last_scanned_at, s.est_listing_tokens, s.est_body_tokens, s.project_root,
    s.metadata_json, s.modified_at,
    s.is_synced, s.hook_events, s.disabled_reason, s.model_invocable, s.shadowed_by_skill_id,
    COALESCE(SUM(CASE WHEN lf.severity = 'error' THEN 1 ELSE 0 END), 0) AS error_count,
    COALESCE(SUM(CASE WHEN lf.severity = 'warning' THEN 1 ELSE 0 END), 0) AS warning_count,
    CASE
      WHEN COUNT(CASE WHEN lf.severity = 'error' THEN 1 END) > 0 THEN 'error'
      WHEN COUNT(CASE WHEN lf.severity = 'warning' THEN 1 END) > 0 THEN 'warning'
      ELSE 'clean'
    END AS lint_status,
    CASE
      WHEN s.shadowed_by_skill_id IS NOT NULL THEN 0
      WHEN s.source_type = 'project' THEN (
        SELECT COUNT(*) FROM skill_invocations si
        JOIN sessions_meta sm ON sm.session_id = si.session_id
        WHERE si.skill_name = s.name
          AND ${SKILL_PROJECT_PATH_SCOPE}
      )
      ELSE (SELECT COUNT(*) FROM skill_invocations si WHERE si.skill_name = s.name)
    END AS total_invocations,
    CASE
      WHEN s.shadowed_by_skill_id IS NOT NULL THEN NULL
      WHEN s.source_type = 'project' THEN (
        SELECT MAX(si.invoked_at) FROM skill_invocations si
        JOIN sessions_meta sm ON sm.session_id = si.session_id
        WHERE si.skill_name = s.name
          AND ${SKILL_PROJECT_PATH_SCOPE}
      )
      ELSE (SELECT MAX(si.invoked_at) FROM skill_invocations si WHERE si.skill_name = s.name)
    END AS last_invoked_at
  FROM s
  LEFT JOIN lint_findings lf ON s.id = lf.skill_id
  GROUP BY s.id
`

export function listSkills(db: Database.Database): SkillRow[] {
  return db.prepare(SKILLS_WITH_USAGE_SELECT).all() as SkillRow[]
}

export function getSkillById(db: Database.Database, id: number): SkillRow | null {
  const row = db.prepare(`SELECT * FROM (${SKILLS_WITH_USAGE_SELECT}) WHERE id = ?`).get(id) as
    SkillRow | undefined
  return row ?? null
}

export interface InsertLintFindingInput {
  skill_id?: number
  rule_id: string
  severity: LintSeverity
  message: string
  detail?: string | null
  file_path?: string | null
  line_number?: number | null
}

export function insertLintFindings(
  db: Database.Database,
  skillId: number,
  findings: InsertLintFindingInput[]
): void {
  const insert = db.prepare(`
    INSERT INTO lint_findings (skill_id, rule_id, severity, message, detail, file_path, line_number, detected_at)
    VALUES (@skill_id, @rule_id, @severity, @message, @detail, @file_path, @line_number, @detected_at)
  `)
  const now = new Date().toISOString()
  const insertMany = db.transaction(() => {
    for (const f of findings) {
      insert.run({
        skill_id: skillId,
        rule_id: f.rule_id,
        severity: f.severity,
        message: f.message,
        detail: f.detail ?? null,
        file_path: f.file_path ?? null,
        line_number: f.line_number ?? null,
        detected_at: now
      })
    }
  })
  insertMany()
}

export function getLintFindingsForSkill(db: Database.Database, skillId: number): LintFindingRow[] {
  return db
    .prepare(
      `SELECT id, skill_id, rule_id, severity, message, detail, file_path, line_number, detected_at
       FROM lint_findings
       WHERE skill_id = ?
       ORDER BY id ASC`
    )
    .all(skillId) as LintFindingRow[]
}

export function replaceAllLintFindings(
  db: Database.Database,
  findings: (InsertLintFindingInput & { skill_id: number })[]
): void {
  const insert = db.prepare(`
    INSERT INTO lint_findings (skill_id, rule_id, severity, message, detail, file_path, line_number, detected_at)
    VALUES (@skill_id, @rule_id, @severity, @message, @detail, @file_path, @line_number, @detected_at)
  `)
  const now = new Date().toISOString()
  const transaction = db.transaction(() => {
    db.prepare('DELETE FROM lint_findings').run()
    for (const f of findings) {
      insert.run({
        skill_id: f.skill_id,
        rule_id: f.rule_id,
        severity: f.severity,
        message: f.message,
        detail: f.detail ?? null,
        file_path: f.file_path ?? null,
        line_number: f.line_number ?? null,
        detected_at: now
      })
    }
  })
  transaction()
}

export interface SkillScanRow {
  name: string
  source_path: string
  plugin_name: string | null
  description: string | null
  est_listing_tokens: number
  est_body_tokens: number
  project_root?: string | null
  license?: string | null
  metadata_json?: string | null
  created_at?: string | null
  modified_at?: string | null
  is_synced?: number
  hook_events?: string | null
  disabled_reason?: string | null
  model_invocable?: number
}

// Upserts `rows` as `sourceType`, then deletes existing `sourceType` rows that
// `computeStalePaths` marks stale. The two exported writers below differ only in
// what "stale" means for their caller — the SQL lives here exactly once.
function writeSkillRows(
  db: Database.Database,
  sourceType: SourceType,
  rows: SkillScanRow[],
  computeStalePaths: (existingPaths: string[]) => string[]
): void {
  const runScan = db.transaction(() => {
    const upsert = db.prepare(`
      INSERT INTO skills
        (name, source_type, source_path, plugin_name, description, last_scanned_at,
         est_listing_tokens, est_body_tokens, project_root, license, metadata_json,
         created_at, modified_at, is_synced, hook_events, disabled_reason, model_invocable)
      VALUES
        (@name, @source_type, @source_path, @plugin_name, @description, @last_scanned_at,
         @est_listing_tokens, @est_body_tokens, @project_root, @license, @metadata_json,
         @created_at, @modified_at, @is_synced, @hook_events, @disabled_reason, @model_invocable)
      ON CONFLICT(source_path) DO UPDATE SET
        name = excluded.name,
        source_type = excluded.source_type,
        plugin_name = excluded.plugin_name,
        description = excluded.description,
        last_scanned_at = excluded.last_scanned_at,
        est_listing_tokens = excluded.est_listing_tokens,
        est_body_tokens = excluded.est_body_tokens,
        project_root = excluded.project_root,
        license = excluded.license,
        metadata_json = excluded.metadata_json,
        created_at = excluded.created_at,
        modified_at = excluded.modified_at,
        is_synced = excluded.is_synced,
        hook_events = excluded.hook_events,
        disabled_reason = excluded.disabled_reason,
        model_invocable = excluded.model_invocable
    `)
    const now = new Date().toISOString()
    for (const row of rows) {
      upsert.run({
        name: row.name,
        source_type: sourceType,
        source_path: row.source_path,
        plugin_name: row.plugin_name,
        description: row.description,
        last_scanned_at: now,
        est_listing_tokens: row.est_listing_tokens,
        est_body_tokens: row.est_body_tokens,
        project_root: row.project_root ?? null,
        license: row.license ?? null,
        metadata_json: row.metadata_json ?? null,
        created_at: row.created_at ?? null,
        modified_at: row.modified_at ?? null,
        is_synced: row.is_synced ?? 0,
        hook_events: row.hook_events ?? null,
        disabled_reason: row.disabled_reason ?? null,
        model_invocable: row.model_invocable ?? 1
      })
    }

    const existingPaths = (
      db.prepare('SELECT source_path FROM skills WHERE source_type = ?').all(sourceType) as {
        source_path: string
      }[]
    ).map((row) => row.source_path)
    const stalePaths = computeStalePaths(existingPaths)

    if (stalePaths.length > 0) {
      const placeholders = stalePaths.map(() => '?').join(', ')
      db.prepare(`DELETE FROM skills WHERE source_path IN (${placeholders})`).run(...stalePaths)
    }
  })

  runScan()
}

// Authoritative over every row of `sourceType` — for scans that read their whole
// source universe in one pass (the plugin registry).
export function writeSkillScanAuthoritative(
  db: Database.Database,
  sourceType: SourceType,
  rows: SkillScanRow[]
): void {
  const seenPaths = new Set(rows.map((row) => row.source_path))
  writeSkillRows(db, sourceType, rows, (existingPaths) =>
    existingPaths.filter((path) => !seenPaths.has(path))
  )
}

// Authoritative only over rows living directly under `rootDirs` — for scans handed
// an explicit, possibly partial, set of roots.
export function writeSkillScan(
  db: Database.Database,
  sourceType: SourceType,
  rows: SkillScanRow[],
  rootDirs: string[]
): void {
  const seenPaths = new Set(rows.map((row) => row.source_path))
  const rootDirSet = new Set(rootDirs)
  writeSkillRows(db, sourceType, rows, (existingPaths) =>
    existingPaths.filter((path) => rootDirSet.has(dirname(path)) && !seenPaths.has(path))
  )
}

export function listAllowedPaths(db: Database.Database): AllowedPathRow[] {
  return db
    .prepare('SELECT path, granted_at FROM allowed_paths ORDER BY granted_at ASC')
    .all() as AllowedPathRow[]
}

export function addAllowedPath(db: Database.Database, path: string): void {
  const resolved = resolve(path)
  const now = new Date().toISOString()
  db.prepare(
    `
    INSERT INTO allowed_paths (path, granted_at)
    VALUES (?, ?)
    ON CONFLICT(path) DO UPDATE SET granted_at = excluded.granted_at
  `
  ).run(resolved, now)
}

export function removeAllowedPath(db: Database.Database, path: string): void {
  const resolved = resolve(path)
  db.prepare('DELETE FROM allowed_paths WHERE path = ?').run(resolved)
}

export function deleteSkillsForProjectRoot(db: Database.Database, projectRoot: string): void {
  const resolvedRoot = resolve(projectRoot)
  const skillsDir = join(resolvedRoot, '.claude', 'skills')
  const rows = db
    .prepare("SELECT id, source_path FROM skills WHERE source_type = 'project'")
    .all() as { id: number; source_path: string }[]

  const idsToDelete = rows
    .filter((row) => {
      const resolvedPath = resolve(row.source_path)
      return (
        resolvedPath === skillsDir ||
        resolvedPath.startsWith(skillsDir + sep) ||
        resolvedPath.startsWith(resolvedRoot + sep)
      )
    })
    .map((row) => row.id)

  if (idsToDelete.length > 0) {
    const placeholders = idsToDelete.map(() => '?').join(', ')
    db.prepare(`DELETE FROM skills WHERE id IN (${placeholders})`).run(...idsToDelete)
  }
}

// A recency list, not a "most common" aggregation — free-form prose won't cluster on exact
// match, so a small LIMIT is more useful here than a GROUP BY that mostly surfaces count-of-1 rows.
const RECENT_TRIGGERS_LIMIT = 5

export function getSkillUsageDetail(db: Database.Database, skill: SkillRow): SkillUsageDetail {
  // A shadowed project skill can never actually have fired (see the precedence note on
  // SKILLS_WITH_USAGE_SELECT above) — its detail view should agree with its forced-0 count
  // rather than show whatever a bare name join happens to find.
  if (skill.shadowed_by_skill_id !== null) {
    return { byTriggerType: [], byProject: [], recentTriggers: [] }
  }

  const scoped = skill.source_type === 'project' && skill.project_root !== null
  const scopeClause = scoped ? `AND ${PARAMETERIZED_PROJECT_PATH_SCOPE}` : ''
  const params = scoped
    ? { skillName: skill.name, root: skill.project_root }
    : { skillName: skill.name }

  const byTriggerType = db
    .prepare(
      `SELECT si.trigger_type, COUNT(*) AS count
       FROM skill_invocations si
       JOIN sessions_meta sm ON sm.session_id = si.session_id
       WHERE si.skill_name = @skillName ${scopeClause}
       GROUP BY si.trigger_type`
    )
    .all(params) as TriggerTypeCount[]

  const byProject = db
    .prepare(
      `SELECT sm.cwd AS cwd, COUNT(*) AS count
       FROM skill_invocations si
       JOIN sessions_meta sm ON sm.session_id = si.session_id
       WHERE si.skill_name = @skillName ${scopeClause}
       GROUP BY sm.cwd`
    )
    .all(params) as ProjectCount[]

  return {
    byTriggerType,
    byProject,
    recentTriggers: getSkillInvocationLog(db, skill, RECENT_TRIGGERS_LIMIT)
  }
}

// Backs both the recent-five list on the Detail page (pass RECENT_TRIGGERS_LIMIT) and the full
// lifetime log behind SkillActivityDialog (omit `limit`). One function, not two, so the three
// correctness behaviours below can't drift apart between the two surfaces:
//   1. a shadowed project skill has no history of its own — the global one ran (see the
//      precedence note on SKILLS_WITH_USAGE_SELECT), so return [] to match its forced-0 count;
//   2. a non-shadowed project skill is scoped to sessions under its own project_root, so two
//      repos with a same-named skill don't cross-contaminate;
//   3. a null preceding_user_text falls back to the reconstructed slash command.
//
// preceding_user_text is returned verbatim — image-caption placeholders included. That string
// ("[Image: original 2438x1460, ...]") is a coordinate-mapping note Claude Code writes into its
// own transcript, not a file reference, so nothing breaks when the image is gone. It renders as
// a labelled row client-side (invocation-prompt.ts). Filtering it here dropped 44% of all rows
// and 83% of visual-verify's — storage and this payload both stay raw.
export function getSkillInvocationLog(
  db: Database.Database,
  skill: SkillRow,
  limit?: number
): SkillInvocationEntry[] {
  if (skill.shadowed_by_skill_id !== null) return []

  const scoped = skill.source_type === 'project' && skill.project_root !== null
  const scopeClause = scoped ? `AND ${PARAMETERIZED_PROJECT_PATH_SCOPE}` : ''
  const limitClause = limit === undefined ? '' : 'LIMIT @limit'

  const params: Record<string, string | number> = { skillName: skill.name }
  if (scoped) params.root = skill.project_root as string
  if (limit !== undefined) params.limit = limit

  return db
    .prepare(
      `SELECT COALESCE(
                si.preceding_user_text,
                CASE
                  WHEN si.args_text IS NOT NULL AND si.args_text != '' THEN '/' || si.skill_name || ' ' || si.args_text
                  ELSE '/' || si.skill_name
                END
              ) AS preceding_user_text,
              si.invoked_at,
              si.trigger_type,
              sm.cwd,
              sm.git_branch,
              si.agent_id
       FROM skill_invocations si
       JOIN sessions_meta sm ON sm.session_id = si.session_id
       WHERE si.skill_name = @skillName ${scopeClause}
       ORDER BY si.invoked_at DESC
       ${limitClause}`
    )
    .all(params) as SkillInvocationEntry[]
}

// Claude Code's real truncation threshold is 8,000 characters — from its compiled binary:
// budget_chars = floor(contextWindow(200000) × 4 × 0.01). That inner ×4 is Claude Code's own
// verified internal chars-per-token constant for this comparison; it's unrelated to, and
// unchanged by, our own CHARS_PER_TOKEN calibration (skill-parser.ts) below. Dividing by
// CHARS_PER_TOKEN instead of a hardcoded 4 keeps `used` (SUM of est_listing_tokens, which is
// also in CHARS_PER_TOKEN units) and `limit` in the same units, so the over/warning/ok comparison
// in context-budget.ts's budgetStatus() stays exactly as correct as it was under chars/4 — only
// the displayed numbers changed when CHARS_PER_TOKEN was recalibrated from 4 to 3.
export const CONTEXT_BUDGET_LIMIT = Math.floor(Math.floor(200000 * 4 * 0.01) / CHARS_PER_TOKEN)

export function getContextBudget(db: Database.Database): ContextBudget {
  // The two audit buckets are mutually exclusive: a disabled skill that is also
  // model_invocable = 0 counts only under excluded* — disabled is the stronger statement.
  const row = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN disabled_reason IS NULL AND model_invocable = 1
                           THEN est_listing_tokens END), 0) AS used,
         COALESCE(SUM(CASE WHEN disabled_reason IS NOT NULL THEN est_listing_tokens END), 0)
           AS excludedTokens,
         COALESCE(SUM(CASE WHEN disabled_reason IS NOT NULL THEN 1 END), 0) AS excludedCount,
         COALESCE(SUM(CASE WHEN disabled_reason IS NULL AND model_invocable = 0
                           THEN est_listing_tokens END), 0) AS userInvocableOnlyTokens,
         COALESCE(SUM(CASE WHEN disabled_reason IS NULL AND model_invocable = 0 THEN 1 END), 0)
           AS userInvocableOnlyCount
       FROM skills WHERE source_type IN ('global', 'plugin')`
    )
    .get() as {
    used: number
    excludedTokens: number
    excludedCount: number
    userInvocableOnlyTokens: number
    userInvocableOnlyCount: number
  }
  return { ...row, limit: CONTEXT_BUDGET_LIMIT }
}

// One row per plugin identity (name+marketplace) — plugin_registry is one-to-many on install, so
// every per-install field (scope, version, project, enablement, timestamps) collapses into
// `installs[]`. Only `marketplace_repo` is still read via MAX() as a genuine no-op tie-break;
// installs of one identity can differ in every other respect once project scope exists.
//
// `installed_version` keeps a MAX() at identity level for the inventory's single Version column,
// which reads installs[].installed_version to decide whether that number is the whole story.
// `disabled_reason` is deliberately not a MAX(): a plugin disabled at user scope but enabled for
// a project is not a disabled plugin, so the identity reports it only when every install agrees.
export function listPlugins(db: Database.Database): PluginRow[] {
  const identities = db
    .prepare(
      `SELECT
         name, marketplace,
         MAX(marketplace_repo) AS marketplace_repo,
         MAX(installed_version) AS installed_version,
         CASE WHEN COUNT(*) = COUNT(disabled_reason) THEN MAX(disabled_reason) END
           AS disabled_reason,
         (SELECT COUNT(*) FROM skills
          WHERE skills.plugin_name = plugin_registry.name || '@' || plugin_registry.marketplace
         ) AS skill_count
       FROM plugin_registry
       GROUP BY name, marketplace`
    )
    .all() as Omit<PluginRow, 'installs'>[]

  // enablement_known is joined against allowed_paths rather than stamped at scan time so it can't
  // go stale when a grant is added or revoked between scans. permissions.ts seeds its in-memory
  // grant set from this same table at startup, so the two always agree. A user install needs no
  // grant (~/.claude/settings.json is Tier 1); a project/local install with no project_path has
  // no root that could ever be granted, so it stays unknown.
  const installs = db
    .prepare(
      `SELECT
         pr.name, pr.marketplace, pr.scope, pr.install_path, pr.installed_at, pr.last_updated,
         pr.git_commit_sha, pr.installed_version, pr.disabled_reason,
         NULLIF(pr.project_path, '') AS project_path,
         CASE WHEN pr.scope = 'user' OR ap.path IS NOT NULL THEN 1 ELSE 0 END AS enablement_known
       FROM plugin_registry pr
       LEFT JOIN allowed_paths ap ON ap.path = pr.project_path`
    )
    .all() as (Omit<PluginInstall, 'enablement_known'> & {
    name: string
    marketplace: string
    enablement_known: number
  })[]

  return identities.map((identity) => ({
    ...identity,
    installs: installs
      .filter((row) => row.name === identity.name && row.marketplace === identity.marketplace)
      .map((row) => ({
        scope: row.scope,
        install_path: row.install_path,
        installed_at: row.installed_at,
        last_updated: row.last_updated,
        git_commit_sha: row.git_commit_sha,
        project_path: row.project_path,
        installed_version: row.installed_version,
        disabled_reason: row.disabled_reason,
        enablement_known: row.enablement_known === 1
      }))
  }))
}

export function getPluginDetail(
  db: Database.Database,
  name: string,
  marketplace: string
): PluginDetailResult | null {
  const plugin = listPlugins(db).find((p) => p.name === name && p.marketplace === marketplace)
  if (!plugin) return null

  const skills = db
    .prepare(`SELECT * FROM (${SKILLS_WITH_USAGE_SELECT}) WHERE plugin_name = ?`)
    .all(`${name}@${marketplace}`) as SkillRow[]

  return {
    plugin,
    skills,
    totalInvocations: skills.reduce((sum, s) => sum + s.total_invocations, 0),
    errorCount: skills.reduce((sum, s) => sum + s.error_count, 0),
    warningCount: skills.reduce((sum, s) => sum + s.warning_count, 0)
  }
}
