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
  project_root TEXT,                   -- granted repo root; NULL for global/plugin. Scopes
                                        -- invocation counts to this repo's own sessions when
                                        -- another repo has a same-named skill.
  license TEXT,                        -- frontmatter `license:`, NULL if absent
  metadata_json TEXT,                  -- frontmatter `metadata:` block, JSON-serialized as-is
  created_at TEXT,                     -- SKILL.md birthtime; NULL for plugin skills (see install_at)
  modified_at TEXT,                    -- SKILL.md mtime; NULL for plugin skills (see install_at)
  is_synced INTEGER NOT NULL DEFAULT 0, -- global skill found under a reserved synced/ dir
                                        -- (claude.ai sync) — lowest-priority source, see
                                        -- docs/skill-scanner.md
  hook_events TEXT,                    -- JSON array of event names from the plugin's declared
                                        -- hooks manifest (.claude-plugin/plugin.json's "hooks"
                                        -- field); NULL for global/project skills and for plugin
                                        -- skills whose plugin declares no hooks
  disabled_reason TEXT,                -- NULL when enabled. 'plugin' when the owning plugin's
                                        -- settings.json enabledPlugins entry is false (Claude Code
                                        -- unloads the whole plugin). 'override' when settings.json
                                        -- skillOverrides has this skill set to "off" (plugin skills
                                        -- can't carry this one — see docs/skill-scanner.md)
  model_invocable INTEGER NOT NULL DEFAULT 1  -- 0 when Claude Code keeps this skill's description
                                        -- out of its skill listing (user-invocable only, so it
                                        -- costs 0 listing tokens). Set by frontmatter
                                        -- 'disable-model-invocation: true' or settings.json
                                        -- skillOverrides '<name>: user-invocable-only'. Distinct
                                        -- from disabled_reason: the skill still runs via /name.
);

CREATE TABLE IF NOT EXISTS sessions_meta (
  session_id TEXT PRIMARY KEY,        -- transcript's `sessionId` (camelCase)
  cwd TEXT NOT NULL,
  git_branch TEXT,                    -- NULL when cwd isn't a git repo
  started_at TEXT NOT NULL,           -- timestamp of the first line carrying a `cwd` field
  message_count INTEGER NOT NULL,     -- count of lines where type IN ('user','assistant')
  continued_in_session_id TEXT,       -- present even when the transcript has no cost-state
  source_mtime_ms INTEGER NOT NULL,   -- transcript file's mtime at last scan — see Scan cadence
  source_size_bytes INTEGER NOT NULL DEFAULT -1,
                                     -- total bytes across the parent transcript and its subagents;
                                     -- pairs with mtime to detect appends that retain the same mtime
  transcript_parser_version INTEGER NOT NULL DEFAULT 0
                                     -- bumps when parser semantics change, forcing a safe one-time reindex
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

-- The table has no non-unique index otherwise (only the source_uuid autoindex), so every
-- skill-usage query full-scans it: SKILLS_WITH_USAGE_SELECT runs a correlated subquery per
-- skill, and getSkillStats reads by skill_name and session_id. Added with the Usage Skills section.
CREATE INDEX IF NOT EXISTS idx_skill_invocations_skill_name ON skill_invocations(skill_name);
CREATE INDEX IF NOT EXISTS idx_skill_invocations_session_id ON skill_invocations(session_id);

CREATE TABLE IF NOT EXISTS plugin_registry (
  name TEXT NOT NULL,
  marketplace TEXT NOT NULL,
  marketplace_repo TEXT,              -- resolved from known_marketplaces.json; NULL if absent
  installed_version TEXT NOT NULL,    -- can literally be the string "unknown"
  scope TEXT NOT NULL CHECK (scope IN ('user', 'project', 'local')),
                                       -- 'project' is committed to the repo (.claude/settings.json),
                                       -- 'local' is that developer's own (.claude/settings.local.json)
  install_path TEXT NOT NULL,
  last_scanned_at TEXT NOT NULL,
  installed_at TEXT,                  -- from installed_plugins.json; NULL if absent
  last_updated TEXT,                  -- from installed_plugins.json; NULL if absent
  git_commit_sha TEXT,                -- absent on semver-pinned installs
  disabled_reason TEXT,               -- NULL when enabled. 'plugin' when the enabledPlugins map
                                       -- resolved for THIS install's scope has name@marketplace
                                       -- set to false. Per-install, not per-identity: two scopes
                                       -- of one plugin can genuinely disagree.
  available_version TEXT,             -- latest version available on the marketplace; NULL if absent/unresolvable
  project_path TEXT NOT NULL DEFAULT '',
                                       -- owning project root for a project/local install, '' for
                                       -- user scope. NOT NULL with an empty-string sentinel rather
                                       -- than nullable because it is part of the primary key:
                                       -- SQLite does not enforce NOT NULL on a non-integer PK, and
                                       -- ON CONFLICT never matches a NULL, so a nullable column
                                       -- here would make every scan insert a duplicate row for
                                       -- every user-scope install. Read back as NULLIF(...,'').
  PRIMARY KEY (name, marketplace, scope, install_path, project_path)
                                       -- install_path alone can't separate installs: Claude Code's
                                       -- cache path is version-addressed
                                       -- (cache/<marketplace>/<plugin>/<version>), so the same
                                       -- plugin at the same version installed for two scopes, or
                                       -- for two different projects, shares one path.
);

CREATE TABLE IF NOT EXISTS allowed_paths (
  path TEXT PRIMARY KEY,              -- resolved repository root
  granted_at TEXT NOT NULL            -- ISO8601
);

CREATE TABLE IF NOT EXISTS prompt_history (
  session_id TEXT NOT NULL,          -- history.jsonl sessionId; NO FK — spans pruned sessions
  project TEXT NOT NULL,             -- raw cwd string, matches sessions_meta.cwd
  typed_at TEXT NOT NULL,            -- history.jsonl timestamp (epoch ms) -> ISO 8601 UTC
  is_slash_command INTEGER NOT NULL  -- 1 = bare ^/[a-z][\w-]*$ line (/clear, /quit); heuristic,
                                     -- conflates tool control with a bare skill run (~1%) — see
                                     -- prompt-history-scanner.ts. Wiped and reloaded each Scan;
                                     -- mirrors history.jsonl, itself capped at Claude Code's
                                     -- cleanupPeriodDays prune (~30d default). No prompt text.
);
CREATE INDEX IF NOT EXISTS idx_prompt_history_typed_at ON prompt_history(typed_at);

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

-- Cost-state mirror for the Usage view's Cost section (docs/usage-analytics.md, PR2). Read
-- verbatim from Claude Code's `cost-state` line — no bottom-up token pricing. Derived cache like
-- every table here: no scan-cache columns, freshness rides sessions_meta's mtime/size/parser-version
-- gate. Rows are stored as parsed; getCostStats joins sessions_meta to identify lineage terminals.
CREATE TABLE IF NOT EXISTS session_cost (
  session_id TEXT PRIMARY KEY REFERENCES sessions_meta(session_id),
  total_cost_usd REAL NOT NULL,
  has_unknown_model_cost INTEGER NOT NULL DEFAULT 0,  -- CC couldn't price a model — total is a low estimate
  is_zeroed INTEGER NOT NULL DEFAULT 0                -- cost-state present but 0/empty (CC v2.1.241-246 artifact)
);

CREATE TABLE IF NOT EXISTS session_model_cost (
  session_id TEXT NOT NULL REFERENCES session_cost(session_id) ON DELETE CASCADE,
  model TEXT NOT NULL,                    -- normalized (normalizeModelKey); date suffix stripped
  cost_usd REAL NOT NULL,
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  thinking_tokens INTEGER NOT NULL,
  cache_read_tokens INTEGER NOT NULL,
  cache_creation_tokens INTEGER NOT NULL,
  web_search_requests INTEGER NOT NULL,
  PRIMARY KEY (session_id, model)
);

-- One row per logical assistant response. Claude Code may write several physical JSONL
-- records for one response (thinking/text/tool blocks); logical_turn_key collapses those
-- records without summing the repeated usage payload.
CREATE TABLE IF NOT EXISTS turn_usage (
  id INTEGER PRIMARY KEY,
  logical_turn_key TEXT NOT NULL UNIQUE,
  source_uuid TEXT NOT NULL UNIQUE,
  session_id TEXT NOT NULL REFERENCES sessions_meta(session_id) ON DELETE CASCADE,
  request_id TEXT,
  message_id TEXT,
  turn_index INTEGER NOT NULL,
  model TEXT NOT NULL,
  effort TEXT CHECK (effort IS NULL OR effort IN ('xhigh', 'high', 'medium', 'low')),
  input_tokens INTEGER NOT NULL,
  cache_read_tokens INTEGER NOT NULL,
  cache_creation_tokens INTEGER NOT NULL,
  cache_creation_5m_tokens INTEGER NOT NULL,
  cache_creation_1h_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  thinking_tokens INTEGER NOT NULL DEFAULT 0,
  web_search_requests INTEGER NOT NULL DEFAULT 0,
  agent_id TEXT,
  active_skill TEXT,
  invoked_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_turn_usage_session_id ON turn_usage(session_id);
CREATE INDEX IF NOT EXISTS idx_turn_usage_invoked_at ON turn_usage(invoked_at);
CREATE INDEX IF NOT EXISTS idx_turn_usage_active_skill ON turn_usage(active_skill);

-- One numeric-only candidate per main transcript for the Resident tax panel. Attachment text is
-- measured during ingest and discarded; no prompt, hook, instruction, or MCP content is stored.
CREATE TABLE IF NOT EXISTS resident_context_sample (
  session_id TEXT PRIMARY KEY REFERENCES sessions_meta(session_id) ON DELETE CASCADE,
  first_turn_at TEXT NOT NULL,
  model TEXT NOT NULL,
  claude_version TEXT,
  cache_read_tokens INTEGER NOT NULL CHECK (cache_read_tokens >= 0),
  measured_tokens INTEGER NOT NULL CHECK (measured_tokens >= 0),
  cost_state_started_at TEXT,
  skill_characters INTEGER NOT NULL CHECK (skill_characters >= 0),
  skill_count INTEGER NOT NULL CHECK (skill_count >= 0),
  agent_characters INTEGER NOT NULL CHECK (agent_characters >= 0),
  agent_count INTEGER NOT NULL CHECK (agent_count >= 0),
  hook_characters INTEGER NOT NULL CHECK (hook_characters >= 0),
  hook_count INTEGER NOT NULL CHECK (hook_count >= 0),
  mcp_characters INTEGER NOT NULL CHECK (mcp_characters >= 0),
  mcp_count INTEGER NOT NULL CHECK (mcp_count >= 0),
  instruction_characters INTEGER NOT NULL CHECK (instruction_characters >= 0),
  instruction_count INTEGER NOT NULL CHECK (instruction_count >= 0)
);

CREATE INDEX IF NOT EXISTS idx_resident_context_sample_first_turn_at
  ON resident_context_sample(first_turn_at);

-- Materialized attribution for priced terminal sessions. A NULL skill_name is the
-- explicit General work bucket; partial indexes make that nullable identity unique.
CREATE TABLE IF NOT EXISTS session_skill_cost (
  session_id TEXT NOT NULL REFERENCES session_cost(session_id) ON DELETE CASCADE,
  skill_name TEXT,
  est_cost_usd REAL NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_session_skill_cost_named
  ON session_skill_cost(session_id, skill_name)
  WHERE skill_name IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_session_skill_cost_general
  ON session_skill_cost(session_id)
  WHERE skill_name IS NULL;
