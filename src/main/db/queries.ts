import type Database from 'better-sqlite3'
import { dirname, join, resolve, sep } from 'path'
import type {
  AllowedPathRow,
  ContextBudget,
  ProjectCount,
  RecentTrigger,
  SkillRow,
  SkillUsageDetail,
  SourceType,
  TriggerTypeCount
} from '../../shared/ipc'

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
      (
        SELECT g.id FROM skills g
        WHERE g.source_type = 'global' AND g.name = skills.name AND skills.source_type = 'project'
        LIMIT 1
      ) AS shadowed_by_skill_id
    FROM skills
  )
  SELECT
    s.id, s.name, s.source_type, s.source_path, s.plugin_name, s.description,
    s.last_scanned_at, s.est_listing_tokens, s.est_body_tokens, s.project_root,
    s.shadowed_by_skill_id,
    CASE
      WHEN s.shadowed_by_skill_id IS NOT NULL THEN 0
      WHEN s.source_type = 'project' THEN (
        SELECT COUNT(*) FROM skill_invocations si
        JOIN sessions_meta sm ON sm.session_id = si.session_id
        WHERE si.skill_name = s.name
          AND (sm.cwd = s.project_root
               OR substr(sm.cwd, 1, length(s.project_root) + 1) = s.project_root || '/')
      )
      ELSE (SELECT COUNT(*) FROM skill_invocations si WHERE si.skill_name = s.name)
    END AS total_invocations,
    CASE
      WHEN s.shadowed_by_skill_id IS NOT NULL THEN NULL
      WHEN s.source_type = 'project' THEN (
        SELECT MAX(si.invoked_at) FROM skill_invocations si
        JOIN sessions_meta sm ON sm.session_id = si.session_id
        WHERE si.skill_name = s.name
          AND (sm.cwd = s.project_root
               OR substr(sm.cwd, 1, length(s.project_root) + 1) = s.project_root || '/')
      )
      ELSE (SELECT MAX(si.invoked_at) FROM skill_invocations si WHERE si.skill_name = s.name)
    END AS last_invoked_at
  FROM s
`

export function listSkills(db: Database.Database): SkillRow[] {
  return db.prepare(SKILLS_WITH_USAGE_SELECT).all() as SkillRow[]
}

export function getSkillById(db: Database.Database, id: number): SkillRow | null {
  const row = db.prepare(`${SKILLS_WITH_USAGE_SELECT} WHERE s.id = ?`).get(id) as
    SkillRow | undefined
  return row ?? null
}

export interface SkillScanRow {
  name: string
  source_path: string
  plugin_name: string | null
  description: string | null
  est_listing_tokens: number
  est_body_tokens: number
  project_root?: string | null
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
         est_listing_tokens, est_body_tokens, project_root)
      VALUES
        (@name, @source_type, @source_path, @plugin_name, @description, @last_scanned_at,
         @est_listing_tokens, @est_body_tokens, @project_root)
      ON CONFLICT(source_path) DO UPDATE SET
        name = excluded.name,
        source_type = excluded.source_type,
        plugin_name = excluded.plugin_name,
        description = excluded.description,
        last_scanned_at = excluded.last_scanned_at,
        est_listing_tokens = excluded.est_listing_tokens,
        est_body_tokens = excluded.est_body_tokens,
        project_root = excluded.project_root
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
        project_root: row.project_root ?? null
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
  const scopeClause = scoped
    ? `AND (sm.cwd = @root OR substr(sm.cwd, 1, length(@root) + 1) = @root || '/')`
    : ''
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

  // 9% of recovered preceding_user_text values are image-caption placeholders like
  // "[Image: original 2438x1460...]" — real, common, and visibly broken if shown as
  // "triggered by". Filtered at query time; storage stays raw as a historical fact.
  const recentTriggers = db
    .prepare(
      `SELECT si.preceding_user_text, si.invoked_at
       FROM skill_invocations si
       JOIN sessions_meta sm ON sm.session_id = si.session_id
       WHERE si.skill_name = @skillName AND si.preceding_user_text IS NOT NULL
         AND si.preceding_user_text NOT LIKE '[Image:%' ${scopeClause}
       ORDER BY si.invoked_at DESC
       LIMIT ${RECENT_TRIGGERS_LIMIT}`
    )
    .all(params) as RecentTrigger[]

  return { byTriggerType, byProject, recentTriggers }
}

// From Claude Code's compiled binary: budget_chars = floor(contextWindow(200000) × 4 × 0.01),
// compared in characters but displayed as tokens — so the token limit is contextWindow × 0.01.
// A live comparison in Claude Code, not a hardcoded threshold; scales with the model's window.
export const CONTEXT_BUDGET_LIMIT = Math.floor(200000 * 0.01)

export function getContextBudget(db: Database.Database): ContextBudget {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(est_listing_tokens), 0) AS used
       FROM skills WHERE source_type IN ('global', 'plugin')`
    )
    .get() as { used: number }
  return { used: row.used, limit: CONTEXT_BUDGET_LIMIT }
}
