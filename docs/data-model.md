# Data model

Owns Megatron's two SQLite files: the index (`megatron.db`, a disposable derived cache) and the
usage archive (`usage-history.db`, which can never be rebuilt). Covers the driver, the invariants
the schema encodes, and plugin identity. `CLAUDE.md` stays authoritative for repo-wide decisions;
the decisions below are locked here.

Table shapes and per-column notes live in `src/main/db/schema.sql` and `usage-archive.ts`.

## Locked decisions

| Area                     | Decision                                                                                                                                                                                                                              | Why                                                                                                                                                                                                                                                                                                                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Store                    | Embedded SQLite                                                                                                                                                                                                                       | The data is relational (a skill has many invocations; an invocation belongs to a session). Single-file and serverless fits local-first and makes "delete my index" a literal `rm`. Rejected: Postgres/MySQL (need a daemon), DuckDB (solves a columnar-analytics scale this app doesn't have)                                                      |
| SQLite driver            | `better-sqlite3`, not `node:sqlite`                                                                                                                                                                                                   | `node:sqlite` is still experimental: the wrong risk for the core data layer. `better-sqlite3` ships N-API prebuilds                                                                                                                                                                                                                                |
| `skill_invocations` join | Text `skill_name`, **no FK** to `skills.id`                                                                                                                                                                                           | Invocations reference skills no scan will find (built-ins, deleted skills, ungranted repos), so the join is best-effort at query time                                                                                                                                                                                                              |
| Plugin identity          | Composite `name@marketplace`, not bare name                                                                                                                                                                                           | `installed_plugins.json` keys plugins this way                                                                                                                                                                                                                                                                                                     |
| Plugin → install         | One-to-many, keyed by `scope` and `project_path` as well as `install_path`                                                                                                                                                            | `installed_plugins.json` values are arrays, and `installPath` is version-addressed, so one plugin at one version installed for two scopes or two projects shares a path                                                                                                                                                                            |
| Marketplace repo         | Read from `known_marketplaces.json`, not `installed_plugins.json`                                                                                                                                                                     | It resolves a plugin's GitHub repo for the Report deep-link ([#14](https://github.com/Megatron-HQ/Megatron/issues/14))                                                                                                                                                                                                                             |
| Index schema changes     | `openIndex()` stamps a fingerprint of `schema.sql` into `PRAGMA user_version`; on a mismatch it deletes `megatron.db` (and its `-wal`/`-shm`/`-journal`) and the startup scan repopulates it. Any edit triggers it, comments included | The index is 100% derived from `~/.claude/`, so deleting it loses nothing, and a shipped user can't be told to run `db:reset`. A false rebuild costs one sub-second rescan; a missed one ships an index that doesn't match the code. Rejected: in-place `ALTER`/rebuild migrations, ~100 lines of the riskiest data-layer code to save that rescan |
| Index open order         | Main opens the index before the scan worker does                                                                                                                                                                                      | The worker takes its path from main, so it never sees a half-rebuilt file                                                                                                                                                                                                                                                                          |
| Folder grants            | Live in `preferences.json` (`grantedFolders`), not the index                                                                                                                                                                          | A rebuild must never cost a re-grant                                                                                                                                                                                                                                                                                                               |

## External file shapes

Verified against real `~/.claude`:

- `plugins/installed_plugins.json` is a wrapper, `{ "version": 2, "plugins": { … } }`, mapping each
  `name@marketplace` key to an **array** of installs, each
  `{ scope, installPath, projectPath, version, installedAt, lastUpdated, gitCommitSha }`. `version`
  can be the literal string `"unknown"`. `scope` is `user`, `project`, or `local`; the last two carry
  `projectPath`. `installPath` is `cache/<marketplace>/<plugin>/<version>`.
- `plugins/known_marketplaces.json` maps each marketplace name to
  `{ source: { source, repo }, installLocation, lastUpdated }`.
- Plugin enablement (`enabledPlugins`) and `skillOverrides` resolve `local > project > user`: user is
  `~/.claude/settings.json`, project is the repo's committed `.claude/settings.json`, local is that
  developer's `.claude/settings.local.json`.
- `history.jsonl` is capped by Claude Code's `cleanupPeriodDays` prune (~30 days by default).

## Index invariants

**Natural keys are the rescan strategy.** `skills` and `sessions_meta` upsert on `source_path` /
`session_id`. Deletion is scoped per root: only rows whose parent directory is a root passed to this
scan, and unseen this pass, are removed. A `source_type`-wide delete was rejected because two
project roots share a `source_type`, so rescanning one repo would sweep the other's skills. The same
reconciliation removes a deleted transcript's invocations, so `args_text` never outlives its source.
`skill_invocations` are immutable events, deduped on the transcript line's `uuid`.

**`prompt_history` is a mirror, not an accumulator.** It is wiped and reloaded from
`history.jsonl` each scan, carries no prompt text, and has no FK (its sessions outlive transcript
pruning). A failed read keeps the last good rows. Long-range history is the usage archive's job.

**Usage stats are computed live, never stored.** `total_invocations`, `last_invoked_at`,
staleness, the context budget, and every Usage aggregate are queries at read time. A stored
counter would need upkeep on every insert and delete, and could drift.

**Skill name collisions.** Two same-named skills are always two rows (`source_path` is the
identity). Attribution follows Claude Code's precedence (`docs/skill-scanner.md`):

- A project skill shadowed by a same-named global skill can never fire: its count is forced to `0`
  and `shadowed_by_skill_id` points at the global row. Known ceiling: if the project skill predates
  the global one, its real past invocations still attribute to the global row.
- A claude.ai-synced global copy is the lowest priority: any same-named non-synced skill shadows
  it, and it never shadows a non-synced project skill.
- A non-shadowed project skill counts only sessions whose `cwd` is under its own `project_root`,
  matched with `substr`, not `LIKE`, because `_` and `%` are literal in real paths. With nested
  repositories, an invocation belongs to the deepest matching root. Windows comparisons normalize
  separators, casing, and trailing separators; POSIX paths stay case-sensitive.
- Nested project skills are never a shadowing relationship: both stay reachable, and
  `skills.name` already carries the name Claude Code records (bare or directory-qualified).
- Global and plugin skills are unscoped by name.
- `SKILLS_WITH_USAGE_SELECT` ("which row shadows this one") and the Usage Skills panel's
  name-to-row resolution ("which row wins this name": global > project > synced) encode the same
  precedence twice; change both together.

**Cost rows are stored as parsed; aggregates read lineages.** `session_cost` mirrors each file's
counter. After every scan `rebuildCostLineages` derives `cost_lineage` (each session's priced head),
`lineage_cost`, and `lineage_model_cost` (each head's exact lineage spend), and every dollar or
token aggregate, the skill-cost allocation, and the archive read those, never raw counters. See
`docs/usage-analytics.md`, hazard 3, for the rule.

**Plugin enablement can be unknowable.** A project/local install's settings live under a Tier 2
root, readable only once granted. The scanner never guesses: `disabled_reason` stays `NULL`, and
`enablement_known` is derived at read time through `isPathAllowed()` so it can't go stale when a
grant changes between scans. Granting or revoking a folder rescans the plugin registry too.
Management actions go through the `claude plugin` CLI; `plugin_registry` stays a read-only scan
cache.

**Plugin update availability resolves offline.** `available_version` comes from local marketplace
caches only, with zero network requests during a scan. A marketplace `installLocation` outside
`~/.claude/plugins/` stays unresolved until its folder is granted: a manifest is never an implicit
permission grant. A moving branch ref like `main` is not a version, so without a commit SHA the
result is `NULL`.

## Usage project identity

Usage keeps a persistent location registry in private `preferences.json` (`usageProjects`),
independent of the index and the live folder catalog. Each location has a stable ID that survives
rediscovery at the same path.

- A working directory belongs to the deepest retained repository root. Parent-folder activity with
  no owning repository is its own workspace. Separate clones and worktrees stay independent.
- A confirmed link merges Usage identity only, applied at query time. It never rewrites source
  records, changes skill or plugin ownership, or grants filesystem access, and unlinking restores
  separate totals without deleting anything. Linking has no UI yet; existing links stay intact.
- A changed path or a matching name never proves a move. Missing folders and revoked grants keep
  their identity and links; ungranted locations are never probed.
- Nothing is written into user repositories.

## `usage-history.db`

The one deliberate exception to the derived-cache rule: a private, local-only archive beside
`megatron.db` with the same file protections. `db:reset`, source pruning, and index rebuilds never
delete it, and nothing syncs off device.

- **Metadata only.** Successful scans copy prompt multiplicities, session/project/model
  identifiers, timestamps, continuation links, and numeric token counters. A fork lineage arrives
  as plain continuation links: each member points at its head, and the head's models row holds the
  lineage's tokens. A link to a head since pruned from the index is kept, so its surviving branches
  aren't counted a second time; rows archived before this rule are left as they are. Full scans also record
  when each plugin skill was first seen, keyed by plugin identity (`name@marketplace`) and the
  namespaced skill name, never the version-addressed `source_path`. No prompt or response content.
  Failed or partial usage sources are not copied; archive writes and the recomputed token shares
  commit in one transaction. Plugin sightings are the exception: they are recorded from whatever
  plugin rows the index holds, because a late sighting only delays the stale signal
  (`docs/usage-analytics.md`, Stale skills).
- **Idempotent identity.** A prompt is identified by session, project, timestamp, and slash
  classification, keeping the maximum observed multiplicity, so rescans neither inflate counts nor
  collapse distinct same-timestamp entries. Responses reuse the scanner's global turn identities.
- **Coverage is explicit.** Only successfully observed `history.jsonl` ranges are recorded. Dates
  outside them are unavailable, incomplete days are partial, and history pruned before Megatron's
  first observation is gone. The archive grows only when Megatron scans; there is no background
  collector.

### Additive-only shape

Shipped builds update in place, so every archive a user has written must open under every later
build. There is no migration framework and no downgrade guard; the shape only grows.

- **Allowed:** new tables; new nullable or defaulted columns added by a guarded
  `ALTER TABLE … ADD COLUMN` in `openUsageArchive()` after its `CREATE TABLE IF NOT EXISTS` block.
  Editing the `CREATE TABLE` text alone does nothing for an existing file.
- **Forbidden:** renaming or dropping a table or column; changing a column's type or nullability;
  changing a primary key or `CHECK`.
- **Enforced by** `src/main/db/usage-archive.test.ts`, which freezes the shipped DDL as a literal.
  That literal is the contract: change the code to satisfy it.
- **Revisit when** a forbidden change is genuinely needed: switch this file to numbered
  `PRAGMA user_version` migrations then, not before.
