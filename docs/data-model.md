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
| Schema changes           | Delete the local index and let it rebuild — no migration code                         | The index is 100% derived from `~/.claude/`; nothing in it is user-authored. See "Schema changes: delete, don't migrate" below                                                                                            |

## Index schema

No upfront sketch — each table was added by the milestone that knew its real shape. All six now
exist: the four below plus `allowed_paths` (Tier-2 folder grants) and `lint_findings` (linter
output), added once the folder picker and linter respectively needed them.

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
                                       -- literally line 0 — see mvp-build-spec's On-disk data
                                       -- shapes section)
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
  args_text TEXT,                     -- kept, not cut — see Idempotency below (the
                                       -- outliving-its-source risk and its fix)
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
```

`allowed_paths` is the Tier-2 grant list the folder picker persists to (`folders:list` /
`folders:pickAndAdd` / `folders:revoke`) — no separate restart-persistence mechanism, the table
itself is the persistence. `lint_findings` is rebuilt whole on each lint pass —
`replaceAllLintFindings` (`src/main/db/queries.ts`) deletes every row and bulk-reinserts findings
for every skill in one transaction, rather than diffing per skill; `skill_id ON DELETE CASCADE`
separately means a rescan that drops a skill row drops its findings too. See
`docs/mvp-build-spec.md`'s Linter rule set for what populates `rule_id`/`severity`/`message`/
`detail`.

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
time, not a cached total — filtered to `disabled_reason IS NULL` (see below), since a disabled
skill costs Claude Code nothing.

**`disabled_reason` (added 2026-08-21)**: nullable `TEXT` on `skills`, stamped at Scan time —
`NULL` when enabled, `'plugin'` when the owning plugin's `enabledPlugins` entry in `settings.json`
is `false` (Claude Code unloads the whole plugin), `'override'` when `settings.json`'s
`skillOverrides` has this skill set to `"off"` (plugin skills can't carry this second reason — see
`docs/skill-scanner.md`). `getContextBudget()` excludes any row with `disabled_reason` set from
`used`, and reports its tokens/count separately as `excludedTokens`/`excludedCount`.

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
- **`is_synced` shadowing (closed 2026-08-18, was Gap 2 in `docs/scanner-coverage-gaps.md`)**: a
  claude.ai-synced skill (`skills.is_synced = 1`, still `source_type: 'global'` — see
  `docs/skill-scanner.md`) is the lowest-priority source. Any same-named non-synced skill —
  global or project — shadows it, same forced-`0`-count/NULL-`last_invoked_at` treatment as
  above, via a second `WHEN` branch in the `shadowed_by_skill_id` subquery
  (`skills.is_synced = 1 AND ns.is_synced = 0`, `COALESCE`d with the existing
  global-shadows-project branch since a row can only be shadowed one way at a time).
- **Nested project skills are not a shadowing relationship (closed 2026-08-18, was Gap 1 in
  `docs/scanner-coverage-gaps.md`)**: a monorepo package's own `.claude/skills/`
  (`docs/skill-scanner.md`) can share a bare name with the repo's top-level project skill —
  unlike every case above, **both stay reachable**, not shadowed. `shadowed_by_skill_id` is
  untouched by this; instead `skills.name` itself carries whatever Claude Code would actually
  invoke that row as (bare, or directory-qualified on collision — see `skill-scanner.md`), so the
  existing no-FK `skill_name` join already attributes each row's invocations correctly with zero
  further query changes.

Implemented in `SKILLS_WITH_USAGE_SELECT` and `getSkillUsageDetail` (`src/main/db/queries.ts`),
which is why `getSkillUsageDetail` takes the full `SkillRow` now, not a bare name — it needs
`source_type`/`project_root`/`shadowed_by_skill_id` to know how to scope.

**Schema changes: delete, don't migrate (revised 2026-08-18)**: `applySchema()`
(`src/main/db/schema.ts`) is `db.pragma('foreign_keys = ON'); db.exec(schemaSql)` — nothing else.
An earlier version retrofitted an existing `megatron.db` in place: guarded
`ALTER TABLE ... ADD COLUMN` for new columns, plus a `CREATE ..._rebuild` / copy / `DROP` / rename
dance for the `CHECK`/`PRIMARY KEY` changes SQLite can't `ALTER`. That bought exactly one thing —
`sessions_meta`'s scan cache (`source_mtime_ms`/`source_size_bytes`/`transcript_parser_version`,
see Scan cadence in `docs/mvp-build-spec.md`) survives a schema change instead of forcing a full
transcript re-read. But that re-read is measured at 0.066s per ~80MB of transcript history and
runs after the window is shown, never blocking startup — and every row in this index is derived
from `~/.claude/`, so nothing is lost by deleting the file outright. ~100 lines of the
highest-risk code in the data layer, buying a sub-second saving nobody has felt yet: not worth it.
Current policy: whoever changes `schema.sql` runs `npm run db:reset` and relaunches; the startup
scan (`main/index.ts`) repopulates everything. The one table this doesn't cover is `allowed_paths`
(Tier-2 folder grants — no scan can rediscover a folder the user picked by hand), which means a
reset means re-granting. Acceptable while the only two people with a `megatron.db` are the two
developers; revisit before the first distributed release, where a shipped user can't be told to
`rm` a file.

**SKILL.md metadata capture (added 2026-08-18)**: `skills` gained four columns beyond the M1
snippet above — `license` and `metadata_json` (frontmatter `license:` / `metadata:` block,
parsed in `skill-parser.ts`), and `created_at` / `modified_at` (`SKILL.md`'s own filesystem
birthtime/mtime, NULL for plugin skills — see `install_at` on `plugin_registry` below for that
case instead). `plugin_registry` gained `installed_at` / `last_updated` / `git_commit_sha`,
read from `installed_plugins.json`.

Not all of these reach the UI. `metadata_json` and `modified_at` are selected in
`SKILLS_WITH_USAGE_SELECT` and exposed on `SkillRow` (shown in `SkillDetail.tsx` as a
"Metadata" badge section and a "Modified" stat). `license` deliberately is not added to
`SkillRow` — it already renders today via a separate, older path: `SkillDetail.tsx`
re-parses raw `SKILL.md` client-side (`parseExtraFrontmatterFields`) and shows any
unrecognized scalar frontmatter key, including `license`, as a badge. `created_at` is captured
but not surfaced — it's near-always identical to `modified_at`.

**Plugin management (added 2026-08-24)**: `plugin_registry` gained `disabled_reason` (same two
values as `skills.disabled_reason`; stamped by `scanPluginRegistry` from the same
`disabledPlugins` lookup already used for that plugin's skill rows, so a zero-skill,
MCP-only plugin now reports its own enabled/disabled state instead of having none). The table
now backs `listPlugins`/`getPluginDetail` in `queries.ts` and the `plugins:list`/`plugins:detail`
IPC channels — the "no query or IPC channel at all" gap above is closed. `installed_at` /
`last_updated` / `git_commit_sha` (previously captured but unsurfaced) are exposed per-install
on `PluginRow.installs[]`. Management actions (enable/disable/update/uninstall) shell out to the
`claude plugin <verb>` CLI (`src/main/plugin-actions.ts`) rather than writing to
`plugin_registry` directly — the table stays a read-only scan cache like every other table here;
a successful action triggers the normal full-rescan-and-broadcast path to pick up the result.

## Why SQLite

The data is relational, not key-value — a skill has many invocations, an invocation belongs
to a session — so joins beat a document or KV store. Embedded and single-file fits
local-first (no server process) and makes "delete my local index" a literal `rm`.
`better-sqlite3` specifically (not `node:sqlite` — see Locked decisions above): ships N-API
prebuilds, no native rebuild needed on install. Postgres/MySQL are the wrong shape (need a
daemon); DuckDB solves a columnar-analytics scale problem this app doesn't have.
