# Megatron: MVP Build Spec

Supersedes the original `Megatron_ MVP Build.pdf` (compiled 2026-08-08, from-zero, no
repository existed yet). This version reflects decisions made after M0 landed and real
`~/.claude` data was available to check assumptions against. **`CLAUDE.md` is the
authoritative source of truth for locked decisions; this doc is the fuller narrative/reference
around them** — where the two conflict, `CLAUDE.md` wins.

A local-first desktop app that inventories, lints, and tracks usage of every skill a Claude
Code user has — global, project, and plugin-installed — starting from a read-only,
deterministic, single-purpose v1.

|              |                                                                                 |
| ------------ | ------------------------------------------------------------------------------- |
| **Platform** | macOS, direct DMG, no App Store                                                 |
| **Stack**    | Electron + React + TS                                                           |
| **Access**   | Read-only, no file writes                                                       |
| **Index**    | Metadata-only SQLite (`better-sqlite3`)                                         |
| **Linter**   | Deterministic, no API key                                                       |
| **Scope**    | Skills only — global, project, plugin (no built-in skills, no sessions/repo UI) |

## Revisions from the original PDF (this session)

- **SQLite driver**: PDF said "prefer `node:sqlite`, fall back to `better-sqlite3`." That's
  superseded — `CLAUDE.md` locks `better-sqlite3` outright (`node:sqlite` rejected as still
  experimental). No `node:sqlite` code path, ever.
- **Built-in skills: cut entirely.** The PDF and an earlier `CLAUDE.md` pass assumed a 4th
  `builtin` skill source (bundled `builtin-skills.json`, names/descriptions from Anthropic
  docs). Reversed: built-in skills aren't user-managed state — no file to point at, nothing to
  lint, no path to go stale, no version to track. Including them is pure maintenance liability
  for a source that doesn't serve "inventory what's mine." `source_type` is a 3-way enum:
  `global` | `project` | `plugin`. (Struck from `CLAUDE.md`'s locked-decisions table already.)
- **Schema created per-milestone, not upfront.** The PDF's full 6-table sketch (`skills`,
  `lint_findings`, `sessions_meta`, `skill_invocations`, `plugin_registry`, `allowed_paths`)
  is vague on the two tables nothing writes to yet (`lint_findings`'s `detail` field — what
  type? `allowed_paths` — needed by what, exactly, before M6-equivalent work exists?).
  Decision: `schema.sql` only declares tables the current milestone's code actually
  populates. Each later milestone adds its own tables when it knows their real shape,
  reviewed as its own small diff — not designed speculatively now and re-litigated later.
- **Tier-2 consent picker moved up, not merged into M2.** Originally last (M6). Moving it to
  right after the inventory UI (M2) so project-tier skills are populatable early rather than
  structurally empty through four milestones. Considered folding its scope directly into M2,
  rejected: M2 is read-only rendering of what M1 already scanned; the picker is a new
  consent/write surface with its own IPC channels and its own persistence question
  (`allowed_paths`). Fusing them roughly doubles M2's actual footprint. Kept as two
  milestones, reordered instead of merged — see renumbered milestone table below.
- **Symlinked global skills: resolved at the source, not in Megatron.** Found this session:
  `~/.claude/skills/grill-me` (and 3 others) were symlinks pointing outside `~/.claude`
  entirely, into a separate `claude-code-setup` repo. Rather than add symlink-target
  validation to the permission model, asked the `claude-code-setup` session (via
  cross-session message) to remove the symlinks and manage that repo a different way. **Done**
  — confirmed all four are now real directories, `~/.claude` no longer points outside itself
  anywhere; that repo is now a manually-synced backup/mirror (`sync-to-repo.sh`), not a live
  symlink target. No scanner-side special-casing needed — see Permission model below for why
  (the decision itself would've held regardless of whether the symlinks got removed).
- **`skill_invocations.args_text`: kept, not cut.** Initially recommended dropping it as a
  literal reading of "metadata-only, no prompt/tool-call bodies." Reversed after discussing
  it: there's a concrete planned feature (analyzing what prompts invoke a skill), the field
  costs nothing extra to capture (the scanner already parses this exact JSON object for
  `skill_name`), and the real risk isn't "second copy exists" (the index is local-only, same
  trust boundary as the source transcripts) — it's the copy **outliving** a deleted source
  transcript. Mitigated by extending the same upsert/scoped-delete reconciliation `skills`
  already uses to `sessions_meta` / `skill_invocations`: delete the source transcript, the
  next scan removes the corresponding rows (`args_text` included) too. See Index schema.
- **Correction to the "not recoverable" call on explicit-vs-autonomous invocation** (this was
  in the Deferred table below, marked "not recoverable from transcript data at all"). Found
  during a post-M1 investigation of real `NULL`-`args_text` rows: it's not recoverable from
  the `Skill` tool_use block's own fields (`caller.type` genuinely never varies), but it _is_
  recoverable by inspecting the **nearest preceding user-role message with string content**.
  Two real, distinguishable shapes were found in actual transcripts: a mention of
  `/skill-name` in the nearest preceding user text (whether a harness-parsed
  `<command-name>/skill-name</command-name>` tag or a bare `/skill-name` sitting inside
  otherwise free-form prose — see the simplification note in Invocation trigger
  classification for why these two collapsed into one category); and no mention at all (the
  assistant invoked the skill on its own, matching context to the skill's own `description`,
  confirmed against a real `Portfolio/CLAUDE.md` rule mandating `visual-verify` after CSS
  changes). `skill_invocations.trigger_type` (added below) encodes this as
  `'user_invoked' | 'autonomous'`, derived deterministically via string/regex matching — no
  LLM call, consistent with the rest of this app's no-API-key posture. See the new Invocation
  trigger classification section.

## Why skills-first

Skill invocations are logged explicitly by Claude Code: every `Skill` tool call in a session
transcript is a structured `tool_use` block carrying the skill name and task args, and every
transcript line carries `timestamp`, `cwd`, `sessionId`, and `gitBranch`. Session → skill →
project → time is a direct join, not an inference — no other Claude Code tool currently
surfaces it. That feasibility is what the rest of this spec is built on.

## Locked decisions

See `CLAUDE.md`'s "Locked decisions" table for the canonical list — this doc doesn't
duplicate it. The one addition from this session not yet folded back into that table:
`permissions.ts` gains an exported `getGrantedPaths(): string[]` (currently `grantPath` /
`isPathAllowed` only support write and membership-check, not enumeration — the skills-scanner
needs to know _which_ project roots to walk).

## Architecture

### Discovery — three sources, one scan

No hardcoded plugin list. The scanner walks:

| Source  | Where                                                                                             | Editable                              | Gated by                                                                                                                                           |
| ------- | ------------------------------------------------------------------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Global  | `~/.claude/skills/*`                                                                              | Yes (later)                           | Tier 1 — auto-trusted                                                                                                                              |
| Project | `<granted-repo>/.claude/skills/*`                                                                 | Yes (later)                           | Tier 2 — explicit picker (see M-numbering below; picker doesn't exist until that milestone ships, so this source is structurally empty until then) |
| Plugin  | For each entry in `~/.claude/plugins/installed_plugins.json`, that entry's `installPath/skills/*` | No — read-only, tagged `plugin:skill` | Tier 1 — auto-trusted                                                                                                                              |

### Permission model

Tier 1 — `~/.claude/{skills,plugins,projects}` — reads at first launch, no dialog. Tier 2 —
repo folders, for discovering project-level skills — requires the onboarding picker. Every
filesystem read in the codebase routes through one function, `isPathAllowed(path)`, checked
against the stored allow-list. No App Sandbox, no security-scoped bookmarks.

Scanner-level rule (this session): re-validate **every individual file read** through
`isPathAllowed()`, even reads underneath an already-granted root. Redundant in the common
case, but it's the thing that actually catches a path-traversal bug (e.g. a skill's
frontmatter linking outside its granted root) instead of just trusting the caller did it
right — consistent with "one chokepoint, no exceptions."

### Real `~/.claude` data — verified this session, not assumed

Checked directly against this machine's `~/.claude` before finalizing M1 shape:

- **`installed_plugins.json` has a wrapper, not a flat map**: `{"version": 2, "plugins": {
"name@marketplace": [{ scope, installPath, version, installedAt, lastUpdated }] } }`. The
  plugin-registry scanner must unwrap `.plugins`, not treat the file's top level as the map.
- **Plugin `installPath` really does contain a nested `skills/` dir** — confirmed e.g.
  `.../claude-plugins-official/frontend-design/unknown/skills/frontend-design/`. `version`
  can literally be the string `"unknown"` (non-semver) — already anticipated by `CLAUDE.md`'s
  "Plugin identity" lock, just confirmed with a real example.
- **`known_marketplaces.json` shape**: `{ marketplaceName: { source: { source, repo },
installLocation, lastUpdated } }` — this is what resolves a plugin's GitHub repo for the
  M5-equivalent "Report" deep-link.
- **`~/.claude/projects/*.jsonl` in the PDF is wrong** — it's actually
  `~/.claude/projects/<project-dir>/*.jsonl` (one subdirectory per project, session files
  nested inside, not flat files directly under `projects/`). Fix the glob before writing the
  transcript scanner.
- **Transcript line shape for a Skill invocation** (verified from a real transcript):
  top-level `isSidechain`, `sessionId` (camelCase) — a snake_case `session_id` also exists at
  the top level in at least some lines, but it is **not** a duplicate: of 10,139 lines carrying
  both fields (checked later, during M1 planning), 5,862 have genuinely different values. Use
  `sessionId` exclusively — never `session_id` — for consistency with `CLAUDE.md`'s existing
  "Transcript double-count" lock, which already references `isSidechain` by that exact casing.
  Skill calls appear as
  `message.content[].type === "tool_use"` with `.name === "Skill"`, `.input.skill` (name),
  `.input.args` (task args text). `cwd`, `gitBranch`, `timestamp` are top-level per line. Also
  carries `caller: { type: "direct" }` — every single observed invocation on this machine has
  this exact value, no variation found. Checked against Claude Code's own docs: this isn't
  publicly documented, and more importantly, **the docs explicitly disclaim the transcript
  format as an internal, versioned implementation detail** — _"scripts that parse these files
  directly can break on any release."_ Two consequences: (1) there is no field anywhere in
  the transcript that distinguishes a user-explicit skill invocation from an
  autonomous/model-triggered one — `caller.type` doesn't encode this, confirmed by research,
  not just absence of a counter-example; see Deferred table. (2) the transcript-scanner should
  be defensive by construction (skip/log malformed or unexpected-shape lines rather than
  crash) since this format can change under us without notice, not just as a hypothetical.
- **Global skills dir _could_ contain symlinks pointing outside `~/.claude` entirely** — it
  did, on this machine, until this session (`~/.claude/skills/grill-me` →
  `/Users/sai/claude-code-setup/skills/grill-me`). Resolved by removing the symlinks at the
  source (see Revisions above), but the general design question is answered regardless: if
  one shows up again, no special-casing is needed. `isPathAllowed()` uses `path.resolve()`,
  which is purely lexical and doesn't follow symlinks — it only ever evaluates the _requested_
  path, which is what determines Tier-1/Tier-2 membership. The OS follows the symlink
  transparently on read; that's consistent with the stated threat model ("accidental
  over-reading, not untrusted code") — a symlink placed under an auto-trusted root is the
  user's own structure, not something to defend against. `skills.source_path` stores the
  _discovered_ path (where Claude Code sees the skill), never the resolved realpath.

## Frontmatter parsing

M1's scanner and M4's linter both need to read `SKILL.md` frontmatter, but for different
purposes, and that shapes how each handles a broken file:

- **M1 (scan time) is best-effort.** It needs _something_ to put in `skills.name` /
  `skills.description` even when frontmatter is broken, and one malformed skill must never
  crash the whole scan. If `yaml.parse()` throws, catch it: still insert a `skills` row,
  falling back to the directory name for `name`, `NULL` for `description`.
- **M4 (lint time) is authoritative.** It re-reads and re-parses each `SKILL.md`
  independently to generate specific, rule-tagged findings — not by reusing M1's cached
  columns. Deliberate, not wasteful duplication: it keeps the `skills` table free of
  linter-only error state (no new column needed to smuggle "why parsing failed" through to a
  linter three milestones away), consistent with "tables land with the milestone that needs
  them."
- **Parser: the `yaml` npm package** (zero deps of its own), not a hand-rolled key:value
  splitter. The reason is specifically Rule 1 below — a hand-rolled parser is permissive by
  construction (that's what makes it simple) and won't reliably distinguish malformed
  frontmatter from simple frontmatter, which defeats the rule's entire purpose. Block
  extraction (finding the `---`...`---` delimiters) is still hand-rolled; only the content
  between them goes through `yaml.parse()`.

## Linter rule set (v1, all static)

Algorithms captured here for planning purposes — expect to revisit specifics once M4 is
actually being built, not treated as locked implementation.

| Rule                                                          | Applies to              | Algorithm                                                                                                                                                                                                                                                           | Certainty                                                                                                                                                                             |
| ------------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Missing or malformed YAML frontmatter                         | Global, project         | No `---`...`---` block at all → "missing." Block found but `yaml.parse()` throws → "malformed," parser's own error message as `detail`                                                                                                                              | Deterministic                                                                                                                                                                         |
| Empty or missing `description` (breaks auto-trigger matching) | Global, project         | Only evaluated when frontmatter parsed successfully (doesn't double-fire if the rule above already caught a parse failure) — `description` key absent, or present but empty/whitespace after trim                                                                   | Deterministic                                                                                                                                                                         |
| File path referenced in skill body that doesn't exist on disk | Global, project, plugin | Regex over the skill body: markdown link targets (`[text](./relative/path)`) and backtick-quoted spans that look path-like (contain `/` or a recognizable extension, no spaces). Resolve each candidate relative to the skill's own directory, `fs.existsSync()` it | Heuristic — false positives (a backtick span that isn't meant as a path) and false negatives (a path mentioned without backticks) both possible; best-effort, not a compiler          |
| Referenced MCP server not present in user's MCP config        | Global, project, plugin | Regex-scan the skill body for `mcp__([a-zA-Z0-9_-]+)__` (Claude Code's actual MCP tool-naming convention), extract the server name, check it against the user's MCP server config                                                                                   | Heuristic on the "find the reference" side; the pattern itself is well-defined. **Where the user's MCP config actually lives is not yet verified against real data** — see Still Open |
| Exact-name collision across sources                           | Global, project, plugin | No file parsing at all — pure query over the already-scanned `skills` table: `GROUP BY name HAVING COUNT(*) > 1`                                                                                                                                                    | Deterministic, cheapest rule by far                                                                                                                                                   |

## Index schema

No upfront sketch — each table lands with the milestone that knows its real shape.
`lint_findings` (needs the linter to exist first to know what a finding looks like) and
`allowed_paths` (needs the picker to need restart-persistence) are deliberately not declared
yet. M1's four tables, DDL settled this session:

```sql
CREATE TABLE IF NOT EXISTS skills (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('global', 'project', 'plugin')),
  source_path TEXT NOT NULL UNIQUE,   -- discovered path, not realpath (see symlinks note above)
  plugin_name TEXT,                   -- 'name@marketplace' composite, plugin-tier only
  description TEXT,                   -- NULL/empty is a valid, lint-worthy state
  last_scanned_at TEXT NOT NULL       -- ISO8601
);

CREATE TABLE IF NOT EXISTS sessions_meta (
  session_id TEXT PRIMARY KEY,        -- transcript's `sessionId` (camelCase)
  cwd TEXT NOT NULL,
  git_branch TEXT,                    -- NULL when cwd isn't a git repo
  started_at TEXT NOT NULL,           -- timestamp of the first line carrying a `cwd` field (not
                                       -- literally line 0 — see Real data section below)
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
    trigger_type IN ('user_invoked', 'autonomous')
  )
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
- `plugin_registry` upserts on `(name, marketplace)`, same pattern as `skills`.

**Forward-looking gap, not blocking M1**: "no migrations, just `CREATE TABLE IF NOT EXISTS`"
works for _new tables_ landing per-milestone, but won't retrofit a new _column_ onto an
existing table once real users have a `megatron.db` on disk (e.g. M6 wanting to add
`latest_known_version` to `plugin_registry`). Needs a guarded `ALTER TABLE ... ADD COLUMN` at
that point — revisit before M7 ships, not now (no shipped `megatron.db` exists yet).

### Scan cadence

Measured on this machine before deciding: 81MB across 146 transcript files, 17,411 total
lines, only 41 are Skill `tool_use` calls (0.24% signal) — a full read-through was 0.066s of
raw I/O alone. A flat full-rescan-every-launch is empirically cheap today, but the cost scales
with _lifetime_ history, not new activity, and most of that history is closed sessions whose
mtime will never change again. Decision: **mtime-skip, not a byte-offset cursor.**
`sessions_meta.source_mtime_ms` (added to the DDL above) is compared via one `fs.statSync()`
per file before parsing; unchanged mtime skips the file entirely. Simpler than a byte-offset
cursor (no seek logic, no truncation/rotation edge cases) while capturing the win where it
actually accumulates. Paired with running the scan after the window is shown, not blocking
`app.whenReady()` — free regardless of caching strategy. No new IPC channel for triggering or
querying scans in M1 — nothing in the renderer consumes one until M2.

### Invocation trigger classification (added post-M1, simplified post-M2)

M1 shipped, then a real-data investigation of `NULL` `args_text` rows (see Revisions above)
found that invocation _origin_ is recoverable from the **nearest preceding user-role message
with string content**, even though it isn't recoverable from the `Skill` tool_use block
itself. Algorithm:

1. Preceding message contains `/<skill-name>` as a substring, word-boundary-checked (so
   `/grill-mean` doesn't false-match `/grill-me`) → `user_invoked`.
2. Else → `autonomous`.

"Preceding" means most-recently-seen `type: 'user'` record with **string** content while
walking a transcript's records in order — not literally the previous line. A triggering
message can be several assistant/tool-result turns before the actual `Skill` call (observed
directly: `visual-verify` fired several lines after the relevant user turn). User-role records
whose `message.content` is an **array** (tool-result-carrying "user" lines, not actual typed
text) are correctly skipped by this check — they don't overwrite the last real message seen.

Implementation lives in `transcript-scanner.ts` as a small pure function, not a new shared
file — unlike `skill-parser.ts`, this has exactly one consumer, so no shared-helper file is
warranted. `extractInvocations` changes from a stateless per-record loop into a stateful
forward scan tracking the last seen string-content user message.

**Known, accepted heuristic limitation**: this is "most recent user text before this
invocation," not proven causality. If one message triggers a cascade of several skill calls
across many turns, a later call in that cascade is still attributed to the same original
message even if it's arguably less directly caused by it. Same category of limitation as the
linter's file-path/MCP-reference heuristics — not something to engineer around.

**Correction (post-M2): the original three-way split (`harness_command` | `text_mention` |
`autonomous`) collapsed to two (`user_invoked` | `autonomous`).** The original design treated
a harness-parsed `<command-name>/skill-name</command-name>` tag and a bare `/skill-name`
mid-prose as separately meaningful categories. A fresh real-data sweep (broader than the
original — every transcript across every project on this machine, not just the ones scanned
at the time, 54 real invocations total) found **zero** `harness_command` rows, same as the
original spot check (0 out of 43 then). The original doc entry attributed this to `harness_command`
being "legitimately unobserved so far" — rare, but real and reachable. That attribution was
wrong. The actual cause: a genuine harness-native `/skill-name <args>` invocation (the CLI's
own slash-command syntax, typed as the entire prompt) **never produces a `Skill` tool_use
block at all.** Concretely: the transcript instead shows a `user`-role record with string
content `<command-message>...</command-message><command-name>/skill-name</command-name>
<command-args>...</command-args>`, immediately followed by a *separate* `isMeta: true`
user-role record whose array content is the skill's injected system prompt — no `tool_use`
step in between. Confirmed against six independent real transcripts, including one in this
repo's own history. So `harness_command` wasn't a rare-but-real bucket waiting to be observed
— it was structurally unreachable by this detection method from the start, because the two
things `classifyTrigger` needs (a `<command-name>` tag *and* a `Skill` tool_use to attach it
to) never co-occur for a true harness command. What _was_ actually being recorded as
`text_mention` with `args_text: null` in every real case checked (10/10 for one recurring
plugin skill) was the model itself, on seeing a bare `/skill-name` mention typed mid-message,
choosing to call the `Skill` tool with no `args` field — a real, distinct mechanism from the
harness's own command routing, correctly flagged as user-triggered either way. Given
`harness_command` could never fire, keeping a three-way enum around it was unrequested
complexity; collapsing the two user-triggered shapes into one `user_invoked` value is a
straight simplification, not a loss of real signal — `args_text` still carries whatever the
model chose to pass along.

**Still-open gap (not fixed by the above, distinct problem)**: true harness-native command
invocations remain **completely invisible to the scanner** — no `skill_invocations` row is
created for them at all, because `extractInvocations` only looks for `Skill` tool_use blocks.
The `<command-name>`/`<command-args>` + `isMeta` shape described above carries real
skill-name and args data that today goes unindexed entirely. Fixing this needs a second
detection path in `extractInvocations` (reading `<command-name>`/`<command-args>` off the
harness-command `user` record directly, independent of any `Skill` tool_use) — not attempted
here; flagged for a deliberate follow-up, not a silent gap.

**Implemented and verified.** Full lint/typecheck/test gate green after the collapse.

**Schema mechanics**: `skill_invocations` was designed immutable/append-only
(`INSERT OR IGNORE`, no update path — see Idempotency below) specifically because its original
columns are true, unchanging facts about what happened. `trigger_type` stayed consistent with
that design rather than becoming a carved-out exception: rather than back-filling the 42
already-indexed rows via a guarded `ALTER TABLE` + forced full rescan (seriously considered,
including the exact SQL), the simpler and equally valid move — given this is pre-ship, no real
user has a `megatron.db` yet — was deleting the local dev database and letting a fresh scan
repopulate everything with `trigger_type` computed from the start. This is the literal
"delete my local index is a `rm`" principle already stated below, applied to a real case
instead of just the local dev database's own accidental drift. The `ALTER TABLE`-on-existing-
tables gap flagged in the Idempotency section below is _still_ real and _still_ deferred to
M7 — this was a case where deleting was legitimately simpler, not a precedent that migrations
are never needed.

## Why SQLite

The data is relational, not key-value — a skill has many invocations, an invocation belongs
to a session — so joins beat a document or KV store. Embedded and single-file fits
local-first (no server process) and makes "delete my local index" a literal `rm`.
`better-sqlite3` specifically (not `node:sqlite` — see Revisions above): ships N-API
prebuilds, no native rebuild needed on install. Postgres/MySQL are the wrong shape (need a
daemon); DuckDB solves a columnar-analytics scale problem this app doesn't have.

## Repo layout (actual, not the PDF's `electron/` sketch)

```text
src/
├── main/                    # app lifecycle, ipc handlers, db, permissions
│   ├── index.ts
│   ├── permissions.ts       # isPathAllowed(), grantPath(), + getGrantedPaths() (M1 addition)
│   ├── db/
│   │   ├── index.ts
│   │   └── schema.sql       # grows per-milestone, not written upfront
│   └── ingest/               # M1 — doesn't exist yet
│       ├── skill-parser.ts       # shared: parse one skill dir's SKILL.md → {name, description} | fallback
│       ├── skills-scanner.ts     # global + project discovery, uses skill-parser.ts
│       ├── transcript-scanner.ts # session metadata + skill invocations
│       └── plugin-registry.ts    # installed_plugins.json + marketplace diff, uses skill-parser.ts
├── preload/                 # narrow typed bridge (contextBridge + ipcRenderer.invoke)
├── renderer/src/             # React app; components/ui/ is shadcn-vendored, don't hand-edit
│   └── views/                # M2+ — SkillInventory.tsx, SkillDetail.tsx, LinterReport.tsx, Onboarding.tsx
└── shared/                  # types/constants shared between main and preload (e.g. IPC channel names)
```

`linter/rules/` (one file per static rule) lands with M4 (renumbered — see below), not before.

### M1 build order and test strategy

Decided this session, before implementation starts:

- **Test fixtures: real temp directories, not mocked `fs`.** `fs.mkdtempSync(path.join(os.tmpdir(), 'megatron-test-'))`, write real `SKILL.md` fixture files, run the scanner against the real directory, clean up in `afterEach`. No precedent either way existed in this repo (`permissions.test.ts` doesn't touch the filesystem at all), so this sets it: mocking `fs` means hand-simulating its exact call signatures and return shapes, which can quietly drift from real behavior — precisely the kind of gap that would've hidden the symlink discovery earlier this session. Real fixtures cost a bit more I/O, negligible at this scale.
- **`skill-parser.ts` is a shared helper, not duplicated logic.** `skills-scanner.ts` (global + project) and `plugin-registry.ts` (plugin) both need to do the same thing — read one skill directory, extract frontmatter, parse with `yaml`, fall back gracefully on failure (see Frontmatter parsing above). Pulled into its own single-responsibility file rather than one scanner importing from the other, which would read as an odd dependency (plugin discovery depending on global/project-walking logic it doesn't need).
- **Build order**: (1) `getGrantedPaths()` on `permissions.ts` — smallest, extends an already-tested module, and `skills-scanner.ts`'s project-tier logic needs it to exist (even though it returns `[]` until M3's picker ships). (2) `skill-parser.ts` — depends only on the `yaml` package decision. (3) `skills-scanner.ts` and `plugin-registry.ts` — both depend on (1) and (2), not on each other; order between them doesn't matter. (4) `transcript-scanner.ts` last — not a hard dependency (shares no code with the skill-parsing side), but it's the highest-complexity, highest-risk piece (JSONL streaming, mtime-skip, uuid dedup, the "format can change without notice" risk flagged above), so it gets built once the simpler pieces are working.

## Build milestones (renumbered this session)

Tier-2 consent moved from last to right after the inventory UI — see Revisions above for why.

| #   | Name                                | What                                                                                                                                                                                                                                             |
| --- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| M0  | Scaffold                            | Electron + React + TS boilerplate, DMG build pipeline stubbed. **Done.**                                                                                                                                                                         |
| M1  | Tier-1 ingestion                    | Scan `~/.claude/skills`, `installed_plugins.json`, `~/.claude/projects/*/*.jsonl`. Populate `skills`, `sessions_meta`, `skill_invocations`, `plugin_registry`. Project-tier will find zero skills until M3 (picker) ships — expected, not a bug. |
| M2  | Skill inventory UI                  | List every skill across all three sources, tagged by origin; plugin entries visually marked read-only.                                                                                                                                           |
| M3  | Tier-2 consent _(moved up from M6)_ | Onboarding folder picker for repos, wired through `isPathAllowed()` / `getGrantedPaths()`. Purpose is narrowly to find project-level skills — not a repo activity view.                                                                          |
| M4  | Deterministic linter _(was M3)_     | Implement the five static rules; surface findings inline in the inventory and detail view.                                                                                                                                                       |
| M5  | Usage stats _(was M4)_              | Join `skill_invocations` with `sessions_meta`: last-used date, invocation count, per-project breakdown as inventory columns.                                                                                                                     |
| M6  | Plugin remediation _(was M5)_       | Version-compare against the marketplace cache for "Check for update"; deep-link to the marketplace repo's GitHub issues for "Report."                                                                                                            |
| M7  | Ship                                | Code-sign, notarize, DMG. No App Store submission lane.                                                                                                                                                                                          |

## Deferred, on purpose (unchanged from PDF, not re-litigated this session)

| Item                                                                                                                | Why not now                                                                                                                                                                                                                                                                                                                                                                                                                   | Revisit when                                                                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| In-app skill editing                                                                                                | Only write surface; a bug here corrupts a file Claude Code executes. If ever built, `references/skills-manager`'s `audit_log.rs` (~80 lines: append-only SQLite table, best-effort writes that swallow failures so logging never blocks the user action, auto-pruned at 10k rows) is a template worth copying, not redesigning from scratch                                                                                   | Read-only inventory shows repeat weekly use                                                                                                                                                                                 |
| Semantic linter (unclear triggers, conflicting/duplicate skills)                                                    | Needs an LLM call — requires an API key and per-scan cost                                                                                                                                                                                                                                                                                                                                                                     | Deterministic linter is stable and trusted                                                                                                                                                                                  |
| Full session content indexing                                                                                       | Would create a second copy of every prompt/tool-call ever made                                                                                                                                                                                                                                                                                                                                                                | A feature (replay, journal) needs message-level bodies, with its own privacy pass                                                                                                                                           |
| Session replay / repo profile UI                                                                                    | Deliberately cut even though the index makes it near-free                                                                                                                                                                                                                                                                                                                                                                     | Skills-only home screen proves the app earns repeat opens                                                                                                                                                                   |
| Fork-a-plugin-skill escape hatch                                                                                    | Adds a "diverged copy" model for one edge case                                                                                                                                                                                                                                                                                                                                                                                | Update + report proves insufficient for stuck/abandoned plugins                                                                                                                                                             |
| Content-hash change detection for skill directories _(raised by the `references/skills-manager` comparison)_        | Not tied to M6 — M6's "check for update" is a version-string compare against the marketplace cache (see Build milestones below), which doesn't need byte-level hashing. The named use case (a "modified since last scan" signal, and a broader manage/edit direction) has no committed milestone yet                                                                                                                          | Same trigger as in-app skill editing above. If it lands, `references/skills-manager`'s `content_hash.rs:55-131` ignore-list approach (`.git`, `.DS_Store`, `__pycache__`, `*.pyc`) is worth reusing rather than reinventing |
| macOS App Sandbox                                                                                                   | Fights Electron's model; `~/.claude` sits outside any user-granted bookmark                                                                                                                                                                                                                                                                                                                                                   | Mac App Store distribution becomes an actual goal — treat as a re-architecture, not a flag                                                                                                                                  |
| Windows / Linux builds                                                                                              | No audience OS data yet                                                                                                                                                                                                                                                                                                                                                                                                       | Target-user OS split justifies it — Electron keeps this a CI change, not a rewrite                                                                                                                                          |
| Cost analytics, MCP dashboard, knowledge graph, journal, coach, marketplace                                         | Out of scope for this MVP entirely                                                                                                                                                                                                                                                                                                                                                                                            | Per original roadmap's Phase 2+                                                                                                                                                                                             |
| **Built-in skills as a 4th source** _(new this session)_                                                            | Not user-managed state — no file, nothing to lint, no version to track. Pure maintenance liability                                                                                                                                                                                                                                                                                                                            | Not expected to be revisited — cut, not deferred                                                                                                                                                                            |
| ~~Distinguishing explicit vs. auto-triggered (self-invoked) skill calls~~ **— corrected, no longer deferred**       | Originally: "not recoverable from transcript data at all," based on `caller.type` never varying. That part still holds. But a later investigation found the _preceding user message_ (not the `Skill` block itself) does carry a recoverable signal — see the Invocation trigger classification section. `skill_invocations.trigger_type` implements this post-M1                                                             | Done, not deferred — kept here for the historical record of the original (too pessimistic) conclusion                                                                                                                       |
| **Full user-prompt / session-content analytics** ("how sessions are going, how to improve") _(raised this session)_ | Materially bigger than `skill_invocations.args_text` (which is already in scope) — this means indexing conversational content across every message in every session. Already covered by the existing "Full session content indexing" and "Cost analytics... journal..." rows above; restated here because it came up in the context of this session's `args_text` discussion and shouldn't be read as quietly approved for M1 | Same trigger as those rows: a specific feature needs it, with its own privacy pass, Phase 2+                                                                                                                                |

## Still open

M1's schema, ingestion, permission, and cadence design is now fully resolved. What's left:

| Item                                                      | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Defensive parsing in the transcript-scanner               | Given the transcript format is explicitly undocumented/unstable per Claude Code's own docs (see Real data section above), the scanner should skip/log malformed or unexpected-shape lines rather than crash. Principle agreed this session; not yet implemented (M1 hasn't been built)                                                                                                                                                                                                                                                                                                                                    |
| Where the user's MCP server config actually lives on disk | Needed for M4's "referenced MCP server not present in config" rule (`~/.claude.json`? a `mcpServers` key in `settings.json`? a per-project `.mcp.json`?). Not yet checked against real data — verify the same way `installed_plugins.json`'s shape was verified, don't assume. Not blocking M1                                                                                                                                                                                                                                                                                                                            |
| `lint_findings` exact shape                               | Deliberately deferred until M4 (linter) knows what a finding actually looks like                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `allowed_paths` exact shape + persistence                 | Deliberately deferred until M3 (picker) needs restart-persistence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Pricing / monetization model                              | Not discussed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Onboarding visual design and copy                         | Not discussed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Beta / early-access distribution mechanism                | Not discussed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| SQLite schema-evolution strategy                          | `schema.sql` is `CREATE TABLE IF NOT EXISTS` only, no `ALTER TABLE` path — fine pre-ship since there's no installed base to migrate, but not once a DMG is on real users' machines with real local DBs. Raised by the `references/skills-manager` comparison (its `migrations.rs` is a real versioned-migration engine, needed there because it stores non-regenerable user state like tags/presets — Megatron's DB is a fully regenerable index, so the right-sized answer may be much lighter, e.g. a `schema_version` pragma + wipe-and-rescan on mismatch). No approach chosen yet — decide before M7 (Ship), not now |
