import Database from 'better-sqlite3'
import { createHash } from 'crypto'
import { join } from 'path'
import { expectedConfigDirectory } from '../config-root'

// One archive per Claude Code config folder: history_coverage records time ranges of one
// history.jsonl, so two profiles can't share a file. ~/.claude keeps the original name, so archives
// written before CLAUDE_CONFIG_DIR support need no migration. A moved folder starts a fresh one.
export function usageArchiveFilename(
  configDirectory: string,
  home: string,
  canonicalDirectory?: string
): string {
  const location = canonicalDirectory ?? expectedConfigDirectory(configDirectory)
  if (location === expectedConfigDirectory(join(home, '.claude'))) return 'usage-history.db'
  return `usage-history-${createHash('sha256').update(location).digest('hex').slice(0, 16)}.db`
}

export function openUsageArchive(path: string): Database.Database {
  const database = new Database(path)
  try {
    database.pragma('busy_timeout = 5000')
    database.pragma('journal_mode = WAL')
    database.exec(`
      CREATE TABLE IF NOT EXISTS history_prompts (
        session_id TEXT NOT NULL, project TEXT NOT NULL, typed_at TEXT NOT NULL,
        is_slash_command INTEGER NOT NULL, copies INTEGER NOT NULL,
        PRIMARY KEY(session_id, project, typed_at, is_slash_command)
      );
      CREATE INDEX IF NOT EXISTS history_prompts_time ON history_prompts(typed_at);
      CREATE TABLE IF NOT EXISTS history_coverage (start_at TEXT PRIMARY KEY, end_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS history_sessions (
        session_id TEXT PRIMARY KEY, project TEXT NOT NULL, started_at TEXT NOT NULL,
        continued_in_session_id TEXT, has_totals INTEGER NOT NULL, is_zeroed INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS history_models (
        session_id TEXT NOT NULL, model TEXT NOT NULL,
        input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL,
        cache_read_tokens INTEGER NOT NULL, cache_creation_tokens INTEGER NOT NULL,
        PRIMARY KEY(session_id, model)
      );
      CREATE TABLE IF NOT EXISTS history_turns (
        logical_turn_key TEXT PRIMARY KEY, source_uuid TEXT NOT NULL UNIQUE,
        session_id TEXT NOT NULL, model TEXT NOT NULL, invoked_at TEXT NOT NULL,
        input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL,
        cache_read_tokens INTEGER NOT NULL, cache_creation_tokens INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS history_turns_session ON history_turns(session_id, model);
      CREATE TABLE IF NOT EXISTS history_token_shares (
        session_id TEXT NOT NULL, project TEXT NOT NULL, model TEXT NOT NULL, allocated_at TEXT NOT NULL,
        input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL,
        cache_read_tokens INTEGER NOT NULL, cache_creation_tokens INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS history_token_shares_time ON history_token_shares(allocated_at);
      CREATE TABLE IF NOT EXISTS history_undated_tokens (
        session_id TEXT NOT NULL, model TEXT NOT NULL,
        input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL,
        cache_read_tokens INTEGER NOT NULL, cache_creation_tokens INTEGER NOT NULL
      );
      -- Keyed by plugin identity, never source_path: the cache path is version-addressed and
      -- changes on every update, which would make a long-installed skill look new.
      CREATE TABLE IF NOT EXISTS history_plugin_skills (
        plugin_name TEXT NOT NULL, skill_name TEXT NOT NULL, first_seen_at TEXT NOT NULL,
        PRIMARY KEY(plugin_name, skill_name)
      );
      -- Metadata only: args and the preceding prompt stay in the index, so they never outlive
      -- their transcript. project is the session's cwd, which scopes a project skill's uses.
      -- trigger_type has no CHECK so a future trigger type can never fail an archive write.
      CREATE TABLE IF NOT EXISTS history_skill_invocations (
        source_uuid TEXT PRIMARY KEY, session_id TEXT NOT NULL, project TEXT NOT NULL,
        skill_name TEXT NOT NULL, invoked_at TEXT NOT NULL, trigger_type TEXT NOT NULL,
        agent_id TEXT
      );
      CREATE INDEX IF NOT EXISTS history_skill_invocations_skill
        ON history_skill_invocations(skill_name, invoked_at);
      -- The raw qualified_name, never a resolved server: attribution moves when Declarations
      -- change, so it is resolved when read. Never input or result content.
      CREATE TABLE IF NOT EXISTS history_mcp_calls (
        tool_use_id TEXT PRIMARY KEY, session_id TEXT NOT NULL, cwd TEXT, project TEXT NOT NULL,
        qualified_name TEXT NOT NULL, invoked_at TEXT NOT NULL, agent_id TEXT,
        is_error INTEGER, is_denied INTEGER, result_chars INTEGER, result_images INTEGER
      );
      CREATE INDEX IF NOT EXISTS history_mcp_calls_name
        ON history_mcp_calls(qualified_name, invoked_at);
      CREATE INDEX IF NOT EXISTS history_mcp_calls_time ON history_mcp_calls(invoked_at);
      -- Time ranges in which every transcript was observed, so a gap reads as unavailable, not 0.
      CREATE TABLE IF NOT EXISTS history_transcript_coverage (
        start_at TEXT PRIMARY KEY, end_at TEXT NOT NULL
      );
    `)
    return database
  } catch (error) {
    database.close()
    throw error
  }
}
