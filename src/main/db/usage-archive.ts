import Database from 'better-sqlite3'

export const USAGE_ARCHIVE_FILENAME = 'usage-history.db'

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
    `)
    return database
  } catch (error) {
    database.close()
    throw error
  }
}
