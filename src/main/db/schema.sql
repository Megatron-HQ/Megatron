CREATE TABLE IF NOT EXISTS skills (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('global', 'project', 'plugin')),
  source_path TEXT NOT NULL UNIQUE,   -- discovered path, not realpath (see symlinks note above)
  plugin_name TEXT,                   -- 'name@marketplace' composite, plugin-tier only
  description TEXT,                   -- NULL/empty is a valid, lint-worthy state
  last_scanned_at TEXT NOT NULL,       -- ISO8601
  est_listing_tokens INTEGER NOT NULL DEFAULT 0,  -- name + description, the always-resident cost
  est_body_tokens INTEGER NOT NULL DEFAULT 0,     -- full SKILL.md, the cost when the skill fires
  project_root TEXT                    -- granted repo root; NULL for global/plugin. Scopes
                                        -- invocation counts to this repo's own sessions when
                                        -- another repo has a same-named skill.
);

CREATE TABLE IF NOT EXISTS sessions_meta (
  session_id TEXT PRIMARY KEY,        -- transcript's `sessionId` (camelCase)
  cwd TEXT NOT NULL,
  git_branch TEXT,                    -- NULL when cwd isn't a git repo
  started_at TEXT NOT NULL,           -- timestamp of the first line carrying a `cwd` field
  message_count INTEGER NOT NULL,     -- count of lines where type IN ('user','assistant')
  source_mtime_ms INTEGER NOT NULL    -- transcript file's mtime at last scan — see Scan cadence
);

CREATE TABLE IF NOT EXISTS skill_invocations (
  id INTEGER PRIMARY KEY,
  source_uuid TEXT NOT NULL UNIQUE,   -- the transcript line's own `uuid` — natural dedup key
  session_id TEXT NOT NULL REFERENCES sessions_meta(session_id),
  skill_name TEXT NOT NULL,           -- no FK to skills.id — locked decision
  args_text TEXT,                     -- kept, not cut — see Revisions above for the reasoning
  invoked_at TEXT NOT NULL,
  trigger_type TEXT NOT NULL CHECK (   -- added post-M1, see Invocation trigger classification
    trigger_type IN ('user_invoked', 'autonomous', 'subagent')
  ),
  agent_id TEXT,                      -- subagent filename stem; NULL for main-session invocations
  preceding_user_text TEXT            -- nearest preceding user message; heuristic, nullable
);

CREATE TABLE IF NOT EXISTS plugin_registry (
  name TEXT NOT NULL,
  marketplace TEXT NOT NULL,
  marketplace_repo TEXT,              -- resolved from known_marketplaces.json; NULL if absent
  installed_version TEXT NOT NULL,    -- can literally be the string "unknown"
  scope TEXT NOT NULL CHECK (scope IN ('user', 'project')),
  install_path TEXT NOT NULL,
  last_scanned_at TEXT NOT NULL,
  PRIMARY KEY (name, marketplace)
);

CREATE TABLE IF NOT EXISTS allowed_paths (
  path TEXT PRIMARY KEY,              -- resolved repository root
  granted_at TEXT NOT NULL            -- ISO8601
);

CREATE TABLE IF NOT EXISTS lint_findings (
  id INTEGER PRIMARY KEY,
  skill_id INTEGER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  rule_id TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('error', 'warning')),
  message TEXT NOT NULL,
  detail TEXT,
  file_path TEXT,
  line_number INTEGER,
  detected_at TEXT NOT NULL           -- ISO8601
);

CREATE INDEX IF NOT EXISTS idx_lint_findings_skill_id ON lint_findings(skill_id);
