# Megatron: Data model

Owns the SQLite index — driver choice, table shapes, and the plugin-identity decisions the
schema encodes. `CLAUDE.md` stays authoritative for repo-wide decisions; the decisions below
are locked here, and this doc is where they are argued.

## Locked decisions

| Area                     | Decision                                                                                | Why                                                                                                                                                                                                                       |
| ------------------------ | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SQLite driver            | `better-sqlite3`, not `node:sqlite`                                                     | `node:sqlite` is still experimental/evolving; wrong risk for the core data layer. `better-sqlite3` v13 ships N-API prebuilds (`prebuilds/darwin-arm64.node` etc.) — no native rebuild needed on install for this platform |
| `skill_invocations` join | Text `skill_name`, **no FK** to `skills.id`                                             | Invocations can reference skills no scan will ever find (built-ins, deleted skills, ungranted repos) — join is best-effort at query time, not enforced. Marked in `schema.sql` itself as a locked decision                |
| Built-in skills          | **Not a skill source, permanently.** No `builtin-skills.json`, no `source: builtin` tag | Not user-managed state — no file to point at, nothing to lint, no path to go stale, no version to track. `source_type` is a 3-way enum: `global` \| `project` \| `plugin`. Cut, not deferred                              |
| Plugin identity          | Key on the composite `name@marketplace`, not bare name                                  | `installed_plugins.json` keys this way; also handles `"version": "unknown"` (non-semver)                                                                                                                                  |
| Plugin → install         | One-to-**many** (array), with a `scope` field (`user` / `project`)                      | `installed_plugins.json` values are arrays, not single objects                                                                                                                                                            |
| Marketplace repo         | Read from `known_marketplaces.json` (separate file), not `installed_plugins.json`       | This is what makes the plugin-remediation milestone's "Report" deep-link to the marketplace's GitHub repo resolvable — see `docs/mvp-build-spec.md` for milestone numbering                                               |

## Index schema

No upfront sketch — each table lands with the milestone that knows its real shape.
`lint_findings` (needs the linter to exist first to know what a finding looks like) and
`allowed_paths` (needs the picker to need restart-persistence) are deliberately not declared
yet. M1's four tables:

```sql
CREATE TABLE IF NOT EXISTS skills (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('global', 'project', 'plugin')),
  source_path TEXT NOT NULL UNIQUE,   -- discovered path, not realpath (see docs/skill-scanner.md)
  plugin_name TEXT,                   -- 'name@marketplace' composite, plugin-tier only
  description TEXT,                   -- NULL/empty is a valid, lint-worthy state
  last_scanned_at TEXT NOT NULL,      -- ISO8601
  est_listing_tokens INTEGER NOT NULL DEFAULT 0,  -- name+description, chars/4 — see docs/mvp-build-spec.md
  est_body_tokens INTEGER NOT NULL DEFAULT 0,     -- full SKILL.md, chars/4
  project_root TEXT                   -- granted repo root; NULL for global/plugin — see
                                       -- Skill name collisions below
);

CREATE TABLE IF NOT EXISTS sessions_meta (
  session_id TEXT PRIMARY KEY,        -- transcript's `sessionId` (camelCase)
  cwd TEXT NOT NULL,
  git_branch TEXT,                    -- NULL when cwd isn't a git repo
  started_at TEXT NOT NULL,           -- timestamp of the first line carrying a `cwd` field (not
                                       -- literally line 0 — see mvp-build-spec's Real data section)
  message_count INTEGER NOT NULL,     -- count of lines where type IN ('user','assistant')
  source_mtime_ms INTEGER NOT NULL,   -- transcript file's mtime at last scan — see Scan cadence
  source_size_bytes INTEGER NOT NULL DEFAULT -1,
                                     -- parent transcript + subagent byte total; pairs with mtime
                                     -- so an append with an unchanged mtime is still rescanned
  transcript_parser_version INTEGER NOT NULL DEFAULT 0
                                     -- parser semantic version; a change forces one safe reindex
);

CREATE TABLE IF NOT EXISTS skill_invocations (
  id INTEGER PRIMARY KEY,
  source_uuid TEXT NOT NULL UNIQUE,   -- the transcript line's own `uuid` — natural dedup key
  session_id TEXT NOT NULL REFERENCES sessions_meta(session_id),
  skill_name TEXT NOT NULL,           -- no FK to skills.id — locked decision
  args_text TEXT,                     -- kept, not cut — see mvp-build-spec's Revisions section
  invoked_at TEXT NOT NULL,
  trigger_type TEXT NOT NULL CHECK (   -- see docs/transcript-ingest.md
    trigger_type IN ('user_invoked', 'autonomous', 'subagent')
  ),
  agent_id TEXT,                      -- subagent filename stem; NULL for main-session invocations
  preceding_user_text TEXT            -- nearest preceding user message; heuristic, nullable —
                                       -- see docs/transcript-ingest.md
);

CREATE TABLE IF NOT EXISTS plugin_registry (
  name TEXT NOT NULL,
  marketplace TEXT NOT NULL,
  marketplace_repo TEXT,              -- resolved from known_marketplaces.json; NULL if absent
  installed_version TEXT NOT NULL,    -- can literally be the string "unknown"
  scope TEXT NOT NULL CHECK (scope IN ('user', 'project')),
  install_path TEXT NOT NULL,
  last_scanned_at TEXT NOT NULL,
  PRIMARY KEY (name, marketplace, install_path)
);
```

**Idempotency / re-scan strategy** — the natural unique key per table _is_ the strategy:

- `skills` / `sessions_meta` reflect current disk state, which can change (a skill deleted, a
  session file grows) — `source_path` / `session_id` are natural keys; scan writes via
  `INSERT ... ON CONFLICT DO UPDATE`. **Correction, found during M1 implementation**: a
  scoped delete keyed on `source_type IN (<tiers scanned>) AND source_path NOT IN (<seen>)`
  (the original plan here) doesn't actually satisfy "rescanning one repo shouldn't delete
  another repo's skills it didn't touch" — two project roots share the same `source_type`, so
  a `source_type`-broad delete sweeps both. Implemented instead as a per-root path-prefix
  match: only rows whose parent directory is one of the roots _actually passed to this scan
  call_ are eligible for deletion, and only if not seen this pass. `plugin-registry.ts` uses
  the equivalent scoping via its own seen-set for plugin-tagged skills and registry rows. This
  same reconciliation, extended to `sessions_meta`/`skill_invocations`, is also the fix for the
  `args_text`-outliving-its-source risk: delete the transcript, the next scan removes the
  corresponding rows. Known remaining ceiling: rows survive if their root is dropped from the
  scan entirely (e.g. a revoked Tier-2 grant) — cleanup only happens on a scan that still
  includes that root and finds it empty; revisit if M3's picker needs eager cleanup-on-revoke.
- `skill_invocations` are immutable historical events (a past Skill call never changes) —
  `source_uuid` from the transcript line itself is the dedup key, so the transcript-scanner
  just does `INSERT OR IGNORE`. No update/delete reconciliation needed for this table beyond
  the cascade-on-vanished-session case above.
- `plugin_registry` upserts on `(name, marketplace, install_path)`, preserving each installed
  scope/location listed under a plugin key.

**Usage stats (M5) are computed live, never stored.** `total_invocations`, `last_invoked_at`, and
the trigger-type/per-project/recent-trigger breakdowns in `getSkillUsageDetail` are all aggregate
queries over `skill_invocations` at read time, joined on `skill_name` (the same no-FK join as
above), not counters maintained on the `skills` row. `skill_invocations` is append-only, so a
stored count would need upkeep on every insert/delete and could drift; a live `COUNT`/`MAX` never
can. The context budget (`getContextBudget`) is the same shape: `SUM(est_listing_tokens)` at read
time, not a cached total.

**Skill name collisions (added 2026-08-16)**: two same-named skills are always two separate
`skills` rows (identity is `source_path`, already `UNIQUE`) — never merged. What changed is how
`total_invocations`/`last_invoked_at` attribute a name's invocations across those rows, per the
precedence Claude Code itself uses (verified against
[code.claude.com/docs/en/skills](https://code.claude.com/docs/en/skills)): personal (global)
always overrides a same-named project skill, everywhere, unconditionally; plugin skills use a
`plugin-name:skill-name` namespace and can't collide with anything.

- A project skill shadowed by a same-named global skill can never actually fire. Its count is
  forced to `0` (not left to a bare name join) and `SkillRow.shadowed_by_skill_id` points at the
  global skill's id. Known ceiling: if the project skill predates the global one, its real past
  invocations still get attributed to the global row — there's no skill-version history to split
  them by.
- A non-shadowed project skill's count is scoped to sessions whose `cwd` is under its own
  `project_root` (`substr`-based prefix match, not `LIKE` — `_`/`%` in a real path are literal
  characters, not wildcards). This is what makes two different repos with a same-named skill
  (e.g. two repos both having their own `visual-verify`) report correct, separate counts instead
  of each absorbing the other's history.
- Global and plugin skills stay unscoped by name — global wins everywhere, plugin skills can't
  collide.

Implemented in `SKILLS_WITH_USAGE_SELECT` and `getSkillUsageDetail` (`src/main/db/queries.ts`),
which is why `getSkillUsageDetail` takes the full `SkillRow` now, not a bare name — it needs
`source_type`/`project_root`/`shadowed_by_skill_id` to know how to scope. See
`docs/scanner-coverage-gaps.md` for two related-but-separate scanner gaps (nested
`.claude/skills/`, the `synced/` folder) found during this same investigation and deliberately
not folded in here.

**Retrofit pattern for new columns (superseded the gap noted below)**: `applySchema()`
(`src/main/db/schema.ts`) runs `CREATE TABLE IF NOT EXISTS` first, then checks each table it's
since grown a column for via `PRAGMA table_info` and runs a guarded `ALTER TABLE ... ADD COLUMN`
if missing — so an existing `megatron.db` on disk picks up a new column on its next launch
without deleting the db. `agent_id` (`skill_invocations`) and `project_root` (`skills`) both use
this. New tables still need no migration at all (`CREATE TABLE IF NOT EXISTS` is enough on its
own); this pattern is only for adding a column to a table that already shipped.

**Forward-looking gap, not blocking M1**: the retrofit pattern above only adds a column with no
default-value backfill logic beyond SQLite's own column default (`NULL` unless the `ALTER TABLE`
specifies one) — fine for a column an existing row simply didn't have data for yet (it gets
filled in on the next scan), not fine for a column that needs computing from other existing rows
at retrofit time. No case has needed that yet.

## Why SQLite

The data is relational, not key-value — a skill has many invocations, an invocation belongs
to a session — so joins beat a document or KV store. Embedded and single-file fits
local-first (no server process) and makes "delete my local index" a literal `rm`.
`better-sqlite3` specifically (not `node:sqlite` — see Locked decisions above): ships N-API
prebuilds, no native rebuild needed on install. Postgres/MySQL are the wrong shape (need a
daemon); DuckDB solves a columnar-analytics scale problem this app doesn't have.
