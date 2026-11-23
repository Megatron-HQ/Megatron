# Data model

Owns Megatron's two SQLite files: the index (`megatron.db`, a disposable derived cache) and the
usage archive (`usage-history.db`, which can never be rebuilt). Covers the driver, the invariants
the schema encodes, and plugin identity. `CLAUDE.md` stays authoritative for repo-wide decisions;
the decisions below are locked here.

Table shapes and per-column notes live in `src/main/db/schema.sql` and `usage-archive.ts`.

## Locked decisions

| Area                     | Decision                                                                                                                                                                                                                                                                                                                      | Why                                                                                                                                                                                                                                                                                                                                                |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Store                    | Embedded SQLite                                                                                                                                                                                                                                                                                                               | The data is relational (a skill has many invocations; an invocation belongs to a session). Single-file and serverless fits local-first and makes "delete my index" a literal `rm`. Rejected: Postgres/MySQL (need a daemon), DuckDB (solves a columnar-analytics scale this app doesn't have)                                                      |
| SQLite driver            | `better-sqlite3`, not `node:sqlite`                                                                                                                                                                                                                                                                                           | `node:sqlite` is still experimental: the wrong risk for the core data layer. `better-sqlite3` ships N-API prebuilds                                                                                                                                                                                                                                |
| `skill_invocations` join | Text `skill_name`, **no FK** to `skills.id`                                                                                                                                                                                                                                                                                   | Invocations reference skills no scan will find (built-ins, deleted skills, ungranted repos), so the join is best-effort at query time                                                                                                                                                                                                              |
| Plugin identity          | Composite `name@marketplace`, not bare name                                                                                                                                                                                                                                                                                   | `installed_plugins.json` keys plugins this way                                                                                                                                                                                                                                                                                                     |
| Plugin → install         | One-to-many, keyed by `scope` and `project_path` as well as `install_path`                                                                                                                                                                                                                                                    | `installed_plugins.json` values are arrays, and `installPath` is version-addressed, so one plugin at one version installed for two scopes or two projects shares a path                                                                                                                                                                            |
| Marketplace repo         | Read from `known_marketplaces.json`, not `installed_plugins.json`                                                                                                                                                                                                                                                             | It resolves a plugin's GitHub repo for the Report deep-link ([#14](https://github.com/Megatron-HQ/Megatron/issues/14))                                                                                                                                                                                                                             |
| Index schema changes     | `openIndex()` stamps a fingerprint of `schema.sql` and the active Claude Code config folder into `PRAGMA user_version`; on a mismatch it deletes `megatron.db` (and its `-wal`/`-shm`/`-journal`) and the startup scan repopulates it. Any edit triggers it, comments included, and so does a launch on another config folder | The index is 100% derived from `~/.claude/`, so deleting it loses nothing, and a shipped user can't be told to run `db:reset`. A false rebuild costs one sub-second rescan; a missed one ships an index that doesn't match the code. Rejected: in-place `ALTER`/rebuild migrations, ~100 lines of the riskiest data-layer code to save that rescan |
| Index open order         | Main opens the index before the scan worker does                                                                                                                                                                                                                                                                              | The worker takes its path from main, so it never sees a half-rebuilt file                                                                                                                                                                                                                                                                          |
| Folder grants            | Live in `preferences.json` (`grantedFolders`), not the index                                                                                                                                                                                                                                                                  | A rebuild must never cost a re-grant                                                                                                                                                                                                                                                                                                               |
| Hidden folders           | Live in `preferences.json` (`hiddenProjects`), not the index, and survive `db:reset`. The scan worker takes them as input, like grants, and leaves every plugin install, MCP project group, discovered project and skill root in or below a hidden folder out of the index. Usage keeps their sessions and cost               | Filtering at query time or in the renderer would leave the SQL rollups (`projectCount`, `warnings`, `disabled_reason`, findings, sidebar nodes) counting rows nobody can see; leaving them out of the derived index keeps every rollup consistent with no query change. Deleting Claude Code's records would break the CLI-only write rule         |

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

Usage keeps a persistent registry of Project Locations in private `preferences.json`
(`usageProjects`), independent of the index and the live folder catalog. Each Project Location has
a stable ID that survives rediscovery at the same path. Terms (Repo, Project Location, Project
Link, Usage Project) are in `CONTEXT.md`.

- **One writer.** Main's owner (`src/main/project-identity.ts`) is the only code that reads or
  writes `usageProjects`, and it holds the list in memory. Every other reader (the scan worker via
  `workerData`, the renderer via the Usage catalog, main's queries) gets a plain snapshot and asks
  it two questions through `readProjectIdentity` (`src/shared/project-identity.ts`):
  `checkoutOf` for Project Skills (proven Project Links and Claude Code's worktree layout, never
  manual links) and `usageProjectOf` for Usage (every link up to the primary).
- **Reconcile at four moments only:** at startup once grants are restored, when the transcript or
  prompt usage sources finish, when main records a Scan (reconcile, apply the Scan's repo findings,
  reconcile again), and on link/unlink. Reads never write; availability status is computed live on
  read, except that an ungranted folder's `missing` comes from the last Scan's existence check,
  held in memory and never persisted. A reconcile that changes nothing writes nothing.
- **Persist first.** A write reaches `preferences.json` before memory and the snapshot change, so
  a failed write leaves both as they were. Scan-driven writes log the failure; link and unlink
  errors go back to the renderer.

- A working directory belongs to the deepest retained repository root. Parent-folder activity with
  no owning repository is its own Usage Project. Separate clones are separate Repos: a matching
  name never proves identity.
- **Worktrees belong to their repository's Canonical Checkout** (terms in `CONTEXT.md`). A
  checkout's `.git` file identifies its administrative directory, whose `commondir` identifies
  the shared Git directory. If the admin directory is ungranted, `worktrees/<name>` in the
  pointer is enough to infer its common directory. A repository's reverse `gitdir` pointer
  can prove a link when the checkout is ungranted. If the pointers disagree, the checkout's
  own pointer wins while the admin directory it names exists; once that directory is provably
  gone (a main checkout renamed without `git worktree repair`), the repository's list wins.
  Submodules and their worktrees stay independent regardless of their names.
- A separate Git directory's Canonical Checkout comes from a checkout's `.git` pointer, then
  `core.worktree`, then the parent of a directory named `.git`. An unknown checkout leaves
  the worktree independent. For a bare repo, a worktree on the repo's `HEAD` branch wins
  (including reftable `HEAD`). The fallback keeps the saved checkout if still live, then
  picks the first live worktree by path. A bare container whose `.git` file points to that
  repository shares the canonical worktree's Usage. Its own skills are skipped.
- A canonical transition requires positive checkout evidence from a complete Git index, carried
  separately from catalog rows (a directly granted stand-in is also a repository row). The common
  Git directory's recorded file identity proves continuity even when only one checkout survives.
  An explicit reverse link can establish continuity for older links without a repository identity.
  A former worktree path that now has its own Git repository separates from its former group.
  Genuine transitions keep retired checkouts, location IDs and manual external Usage associations.
  Skill checkout links remain direct to the new Canonical Checkout.
- A listed worktree counts as pruned unless locked when an existing granted folder above it
  shows it gone. A missing grant (an unmounted volume) proves nothing. Outside grants, the
  repository list is the available evidence. Saved Usage links survive pruning and move
  when newer evidence identifies a different checkout. A new link cannot target Git metadata
  or a provably absent checkout. Reconciliation clears saved links into Git metadata and
  removes the former target when it has neither activity nor references.
- The `<repo>/.claude/worktrees/<name>` layout supplies evidence without a filesystem read
  (verified 2026-11-15). This applies to project-local hook folders and excludes the active
  Claude Code Folder and `~/.claude`. Saved links inferred from the excluded layout are
  cleared. Git evidence takes precedence. Jujutsu workspaces and `git-new-workdir` supply
  no Git worktree evidence. Revisit Jujutsu if users report split Usage for one repository.
- Usage stores `linkedTo` in preferences; `worktree: true` marks a proven Project Link, any other
  `linkedTo` is manual. Git evidence also records `worktreeEvidence: "git"` so a proven link
  survives the layout cleanup. Project-skill scoping follows proven links to the Canonical
  Checkout. Usage grouping can also follow the checkout's manual link to another Usage Project.
  Source working directories remain intact. A worktree created and pruned between scans can leave
  no evidence.
- A manual Project Link merges Usage identity only, applied at query time. It never rewrites source
  records, changes skill or plugin ownership, or grants filesystem access, and unlinking restores
  separate totals without deleting anything. Linking has no UI yet; existing links stay intact.
- A changed path or a matching name never proves a move. Missing folders and revoked grants keep
  their identity and links; ungranted Project Locations are never probed.
- Nothing is written into user repositories.
- **Claude app chats.** A Claude desktop chat started without a folder runs in
  `<Claude app data>/scratch-workspaces/<id>/<id>/scratch-YYYY-MM-DD-<hex>`
  (`isClaudeAppScratchPath`). It stays an ordinary Project Location, but the catalog marks it as a chat at
  read time with its title and earliest known start, and grant suggestions skip it: Megatron never
  asks to read Claude's app data. Titles (`sessions_meta.title`: last custom title, else last AI
  title) live in the index only. They are never written to `preferences.json` or the archive,
  which copies explicit columns, so a chat's own words go when its transcript does.

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
  namespaced skill name, never the version-addressed `source_path`. Complete transcript scans also
  copy one row per Skill Invocation (`source_uuid`) and per MCP tool call (`tool_use_id`): skill or
  raw `qualified_name`, session, the session's cwd (and the call's own), time, trigger type, agent
  id, and a call's error, refusal and result size (#51). Never `args_text`, `preceding_user_text`,
  tool input, or result content; MCP attribution is resolved when read, never stored. While the
  index holds a row its reading wins; a pruned row keeps what was archived. No prompt or response
  content.
  Failed or partial usage sources are not copied; archive writes and the recomputed token shares
  commit in one transaction. Plugin sightings are the exception: they are recorded from whatever
  plugin rows the index holds, because a late sighting only delays the stale signal
  (`docs/usage-analytics.md`, Stale skills).
- **Idempotent identity.** A prompt is identified by session, project, timestamp, and slash
  classification, keeping the maximum observed multiplicity, so rescans neither inflate counts nor
  collapse distinct same-timestamp entries. Responses reuse the scanner's global turn identities.
- **Coverage is explicit.** Only successfully observed `history.jsonl` ranges are recorded. Dates
  outside them are unavailable, incomplete days are partial, and history pruned before Megatron's
  first observation is gone. Transcripts have their own ranges (`history_transcript_coverage`),
  from the oldest retained transcript's mtime to the scan: Claude Code prunes transcripts by
  mtime, so everything after that point is still on disk whatever `cleanupPeriodDays` is, while
  rows before it may be partial. Hidden projects are left out of the index, so their calls are
  archived only while visible. The archive grows only when Megatron scans; there is no
  background collector.
- **Read back through an attachment.** Main attaches the archive to its index connection
  (`known-calls.ts`), so Uses, Last used, a skill's trigger and project breakdown, its
  invocation log, the Usage section's Skills windows and invocation lists, and MCP call counts
  (server list and Usage panel) read every archived row plus any index row a partial scan hasn't
  archived yet, each once. A row only the archive holds is marked pruned: its args, prompt and
  branch went with the transcript. These counts are complete from the start of the latest unbroken
  transcript coverage, which the UI names. Skill cost attribution still prices only sessions the
  index holds: a pruned use counts toward a window's uses but, like any use without a session
  cost, is left out of the cost split (#72). Without the attachment (the scan worker, a damaged
  archive) every reader falls back to the index.
- **One archive per Claude Code config folder.** `~/.claude` keeps `usage-history.db`; any other
  `CLAUDE_CONFIG_DIR` folder gets `usage-history-<first 16 hex of sha256(canonical path)>.db`
  (`usageArchiveFilename()`). Coverage ranges describe one `history.jsonl`, so profiles never share
  a file, and the original name needs no migration. A folder linked to `~/.claude`, or spelled in
  another case, shares its archive; a moved or renamed folder starts a fresh one. No archive is
  ever deleted, so switching back finds the old one intact. A named folder's canonical target
  is fixed for that process. Main and the scan worker use the same archive path. A launch while
  the configured alias is unavailable uses its last known target to find the cached data. A
  restart on a new target rebuilds the derived index even if the configured alias was unchanged.

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
