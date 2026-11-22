import type Database from 'better-sqlite3'

// The usage archive (usage-history.db) keeps Skill Invocations and MCP calls after Claude Code
// prunes their transcripts (#51). Main attaches it to its index connection under this name so one
// query can read both; the scan worker and tests that never attach it read the index alone.
const ARCHIVE_SCHEMA = 'usage_archive'
const REQUIRED_TABLES = [
  'history_skill_invocations',
  'history_mcp_calls',
  'history_transcript_coverage'
] as const

export function hasUsageArchive(db: Database.Database): boolean {
  return (
    db.prepare('SELECT 1 FROM pragma_database_list WHERE name = ?').get(ARCHIVE_SCHEMA) !==
    undefined
  )
}

// The caller opens the file with openUsageArchive() first, which creates the tables. Anything else
// is detached again so every query stays on the index rather than failing on a missing table.
export function attachUsageArchive(db: Database.Database, archivePath: string): void {
  if (hasUsageArchive(db)) return
  db.prepare(`ATTACH DATABASE ? AS ${ARCHIVE_SCHEMA}`).run(archivePath)
  try {
    const present = new Set(
      db
        .prepare(`SELECT name FROM ${ARCHIVE_SCHEMA}.sqlite_master WHERE type = 'table'`)
        .pluck()
        .all() as string[]
    )
    const missing = REQUIRED_TABLES.filter((table) => !present.has(table))
    if (missing.length > 0) throw new Error(`${archivePath} is not a usage archive`)
  } catch (error) {
    db.prepare(`DETACH DATABASE ${ARCHIVE_SCHEMA}`).run()
    throw error
  }
}

const INDEX_INVOCATIONS = `
  SELECT si.source_uuid, si.session_id, si.skill_name, si.invoked_at, si.trigger_type,
    si.agent_id, sm.cwd AS cwd, si.id AS index_id, si.args_text, si.preceding_user_text,
    sm.git_branch, 0 AS transcript_pruned
  FROM skill_invocations si JOIN sessions_meta sm ON sm.session_id = si.session_id`

// skill_name and invoked_at come straight from the archive row so a filter on them can use its
// index: a source_uuid never changes skill or time. The rest prefers the index's current reading.
const ARCHIVED_INVOCATIONS = `
  SELECT a.source_uuid, a.session_id, a.skill_name, a.invoked_at,
    COALESCE(si.trigger_type, a.trigger_type) AS trigger_type,
    CASE WHEN si.id IS NULL THEN a.agent_id ELSE si.agent_id END AS agent_id,
    COALESCE(sm.cwd, a.project) AS cwd, si.id AS index_id, si.args_text, si.preceding_user_text,
    sm.git_branch, CASE WHEN si.id IS NULL THEN 1 ELSE 0 END AS transcript_pruned
  FROM ${ARCHIVE_SCHEMA}.history_skill_invocations a
  LEFT JOIN skill_invocations si ON si.source_uuid = a.source_uuid
  LEFT JOIN sessions_meta sm ON sm.session_id = si.session_id`

// A parenthesized subquery: every Skill Invocation Megatron knows of, each once. Columns:
// source_uuid, session_id, skill_name, invoked_at, trigger_type, agent_id, cwd (the session's),
// index_id, args_text, preceding_user_text, git_branch, transcript_pruned (1 when only the
// archive holds it, so its args, prompt and branch are gone with the transcript).
export function knownSkillInvocationsSql(db: Database.Database): string {
  if (!hasUsageArchive(db)) return `(${INDEX_INVOCATIONS})`
  return `(${ARCHIVED_INVOCATIONS}
    UNION ALL ${INDEX_INVOCATIONS}
    WHERE NOT EXISTS (SELECT 1 FROM ${ARCHIVE_SCHEMA}.history_skill_invocations a
                      WHERE a.source_uuid = si.source_uuid))`
}

const INDEX_CALLS = `
  SELECT c.tool_use_id, c.session_id, c.cwd, c.qualified_name, c.invoked_at, c.agent_id,
    c.is_error, c.is_denied, c.result_chars, c.result_images
  FROM mcp_tool_calls c`

const ARCHIVED_CALLS = `
  SELECT a.tool_use_id, a.session_id,
    CASE WHEN c.tool_use_id IS NULL THEN a.cwd ELSE c.cwd END AS cwd,
    a.qualified_name, a.invoked_at,
    CASE WHEN c.tool_use_id IS NULL THEN a.agent_id ELSE c.agent_id END AS agent_id,
    COALESCE(c.is_error, a.is_error) AS is_error, COALESCE(c.is_denied, a.is_denied) AS is_denied,
    COALESCE(c.result_chars, a.result_chars) AS result_chars,
    COALESCE(c.result_images, a.result_images) AS result_images
  FROM ${ARCHIVE_SCHEMA}.history_mcp_calls a
  LEFT JOIN mcp_tool_calls c ON c.tool_use_id = a.tool_use_id`

// A parenthesized subquery with mcp_tool_calls' columns: every MCP call Megatron knows of, once.
export function knownMcpCallsSql(db: Database.Database): string {
  if (!hasUsageArchive(db)) return `(${INDEX_CALLS})`
  return `(${ARCHIVED_CALLS}
    UNION ALL ${INDEX_CALLS}
    WHERE NOT EXISTS (SELECT 1 FROM ${ARCHIVE_SCHEMA}.history_mcp_calls a
                      WHERE a.tool_use_id = c.tool_use_id))`
}

// Since when every use is counted: the start of the latest unbroken transcript coverage. Before
// any is recorded, the oldest retained transcript's mtime, the point from which Claude Code's
// mtime-based pruning has left every transcript in place. Older known uses are still counted.
export function usageHistorySince(db: Database.Database): string | null {
  if (hasUsageArchive(db)) {
    const start = db
      .prepare(
        `SELECT start_at FROM ${ARCHIVE_SCHEMA}.history_transcript_coverage
         ORDER BY end_at DESC LIMIT 1`
      )
      .pluck()
      .get() as string | undefined
    if (start !== undefined) return start
  }
  const oldest = db.prepare('SELECT MIN(source_mtime_ms) FROM sessions_meta').pluck().get() as
    number | null
  return oldest === null ? null : new Date(oldest).toISOString()
}
