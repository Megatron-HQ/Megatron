# Megatron: MVP Build Spec

A local-first desktop app that inventories, lints, and tracks usage of every skill a Claude Code
user has — global, project, and plugin-installed — read-only, deterministic, single-purpose.
**Locked decisions live in `CLAUDE.md` (repo-wide) and in the subsystem docs it routes to; this
doc covers architecture detail, linter rules, parsing, and what's still open.** Where this doc
conflicts with a locked decision, the locked decision wins.

|              |                                                                                 |
| ------------ | --------------------------------------------------------------------------------- |
| **Platform** | macOS, direct DMG, no App Store                                                   |
| **Stack**    | Electron + React + TS                                                             |
| **Access**   | Read-only, no file writes                                                         |
| **Index**    | Metadata-only SQLite (`better-sqlite3`)                                           |
| **Linter**   | Deterministic, no API key                                                         |
| **Scope**    | Skills only — global, project, plugin (no built-in skills, no sessions/repo UI)   |

**Schema philosophy**: each table in `schema.sql` was added by the milestone that needed it,
not sketched upfront — the schema grows as a series of small, reviewed diffs rather than one
speculative design.

## Why skills-first

Skill invocations are logged explicitly by Claude Code: every `Skill` tool call in a session
transcript is a structured `tool_use` block carrying the skill name and task args, and every
transcript line carries `timestamp`, `cwd`, `sessionId`, and `gitBranch`. Session → skill →
project → time is a direct join, not an inference — no other Claude Code tool currently surfaces
it.

## Locked decisions

This doc doesn't hold locked decisions — each is locked in the doc that owns the subsystem:
`CLAUDE.md` (repo-wide, including renderer state), `docs/skill-scanner.md` (sources, symlinks),
`docs/transcript-ingest.md` (ingest, trigger classification), `docs/data-model.md` (driver,
schema, plugin identity), `DESIGN.md` (visual system).

One addition not yet written up in any of those docs: `permissions.ts` exports
`getGrantedPaths(): string[]` (`grantPath`/`isPathAllowed` handle write and membership-check;
this handles enumeration — the skills-scanner uses it to know which project roots to walk).

## Architecture

### Discovery — three sources, one scan

No hardcoded plugin list. The scanner walks:

| Source  | Where                                                                                             | Editable                              | Gated by                                                            |
| ------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------- |
| Global  | `~/.claude/skills/*`                                                                                  | Yes (later)                           | Tier 1 — auto-trusted                                               |
| Project | `<granted-repo>/.claude/skills/*`                                                                     | Yes (later)                           | Tier 2 — explicit picker (the sidebar's "Manage Folders" dialog)    |
| Plugin  | For each entry in `~/.claude/plugins/installed_plugins.json`, that entry's `installPath/skills/*`     | No — read-only, tagged `plugin:skill` | Tier 1 — auto-trusted                                               |

### Permission model

Tier 1 — `~/.claude/{skills,plugins,projects}` — reads at first launch, no dialog. Tier 2 — repo
folders, for discovering project-level skills — granted through the "Manage Folders" dialog
(`ManageFoldersDialog.tsx`), reachable any time from the sidebar rather than a one-time onboarding
wizard. Every filesystem read routes through one function, `isPathAllowed(path)`, checked against
the stored allow-list (`allowed_paths` table). No App Sandbox, no security-scoped bookmarks.

Scanner-level rule: re-validate **every individual file read** through `isPathAllowed()`, even
reads underneath an already-granted root — this is what catches a path-traversal bug (e.g. a
skill's frontmatter linking outside its granted root), not just trusting the caller.

### On-disk data shapes (verified against real `~/.claude`, not assumed)

- `installed_plugins.json`: `{"version": 2, "plugins": { "name@marketplace": [{ scope,
  installPath, version, installedAt, lastUpdated }] } }` — a wrapper, not a flat map; unwrap
  `.plugins`. `installPath` contains a nested `skills/` dir. `version` can literally be the
  string `"unknown"` (non-semver).
- `known_marketplaces.json`: `{ marketplaceName: { source: { source, repo }, installLocation,
  lastUpdated } }` — resolves a plugin's GitHub repo for M6's "Report" deep-link.
- Transcripts live at `~/.claude/projects/<project-dir>/*.jsonl` — one subdirectory per project,
  not flat files directly under `projects/`.
- A Skill invocation line has: top-level `isSidechain`, `sessionId` (camelCase — a `session_id`
  also exists at the top level but is not a duplicate; use `sessionId` exclusively, consistent
  with `docs/transcript-ingest.md`'s "Transcript double-count" lock). `message.content[].type
  === "tool_use"` with `.name === "Skill"`, `.input.skill` (name), `.input.args` (task args
  text). `cwd`, `gitBranch`, `timestamp` are top-level per line. `caller: { type: "direct" }` on
  every observed invocation, but this is undocumented and Claude Code's own docs explicitly
  disclaim the transcript format as internal/versioned — `transcript-scanner.ts` wraps each
  line's `JSON.parse` in its own `try`/`catch` and skips malformed lines rather than crashing the
  scan, since this format can change under us without notice.
- There is no field that distinguishes a user-explicit skill invocation from an
  autonomous/model-triggered one at the `Skill` tool_use block itself (`caller.type` never
  varies) — see `docs/transcript-ingest.md` for how origin is recovered instead.
- Global skills dir can contain symlinks pointing outside `~/.claude` entirely — resolved by
  policy, not special-cased: `isPathAllowed()` uses `path.resolve()`, purely lexical, evaluating
  only the _requested_ path; the OS follows the symlink transparently on read. Consistent with
  the stated threat model (accidental over-reading, not untrusted code). `skills.source_path`
  stores the discovered path, never the resolved realpath.

## Frontmatter parsing

The scanner (scan time) and the linter (lint time) both read `SKILL.md` frontmatter, for
different purposes:

- **Scan time is best-effort.** One malformed skill must never crash the whole scan — if
  `yaml.parse()` throws, still insert a `skills` row, falling back to the directory name for
  `name`, `NULL` for `description`.
- **Lint time is authoritative.** `yaml-frontmatter.ts` re-reads and re-parses each `SKILL.md`
  independently to generate specific, rule-tagged findings, rather than reusing the scanner's
  cached columns — keeps the `skills` table free of linter-only error state.
- **Parser: the `yaml` npm package** (zero deps of its own), not a hand-rolled key:value
  splitter — a hand-rolled parser is permissive by construction and won't reliably distinguish
  malformed frontmatter from simple frontmatter, defeating the linter's "missing or malformed"
  rule. Block extraction (finding the `---`...`---` delimiters) is hand-rolled; only the content
  between them goes through `yaml.parse()`.

## Token estimation

`est_listing_tokens` / `est_body_tokens` (`src/main/ingest/skill-parser.ts`) use
`Math.round(text.length / CHARS_PER_TOKEN)`. `CHARS_PER_TOKEN` was originally `4`, read verbatim
out of Claude Code's compiled binary as the literal mechanism that decides when a live session
truncates a skill's description. **Recalibrated to `3` on 2026-08-24** after comparing Megatron's
estimate against Claude Code's own `/context` command output (which shows real per-skill token
counts) across 25 skills: chars/4 averaged only 74.6% of the real number — a consistent
undercount, not noise. `4 × 0.746 ≈ 3.0` fits the real numbers far better (e.g. a 1,367-character
skill: chars/4 gives 342 vs. a real 460; chars/3 gives 456).

This is now an honestly-labeled empirical approximation, not a verbatim binary constant, and it's
the closest available one: Claude Code doesn't publish an offline tokenizer for current models,
and Anthropic's own docs (the `claude-api` skill's `token-counting.md`) explicitly disclaim
third-party tokenizers — "Any estimate from tiktoken, gpt-tokenizer, or similar is wrong for
Claude." The only exact source of truth is Anthropic's network `count_tokens` API, ruled out here
because it would break Megatron's local-first/offline scan (network dependency, credential
management, per-skill API calls during what's otherwise a sub-second local scan).

Four details, each easy to get subtly wrong, still hold regardless of the divisor's value:

- `Math.round`, not floor or ceil.
- JS string length (`str.length`), not UTF-8 byte length — they diverge on multi-byte characters.
- `[name, description].filter(Boolean).join(' ')` — when `description` is `null`, the estimate is
  `name` alone, not `name + ' '`.
- Descriptions are capped at 1536 chars before counting (`skillListingMaxDescChars` in the
  binary) — the estimate mirrors the cap or it overstates real skills that exceed it. This cap
  value itself is still verbatim from the binary, unaffected by the `CHARS_PER_TOKEN` recalibration.

The context budget constant (`CONTEXT_BUDGET_LIMIT` in `src/main/db/queries.ts`, now 2,666, was
2,000) is derived from the same real, unchanged 8,000-character truncation threshold
(`contextWindow(200000) × 4 × 0.01` — that inner `× 4` is Claude Code's own internal constant,
distinct from and unaffected by our `CHARS_PER_TOKEN`) divided by the same `CHARS_PER_TOKEN` used
above, so the over/warning/ok comparison against real truncation risk is exactly as correct as it
was before the recalibration — only the displayed numbers changed.

**All of these — `4`, `0.01`, `200000`, `1536` — are undocumented internal detail from one
point-in-time build of Claude Code, not a public contract.** Corroboration for Megatron's own
heuristic, not something Megatron depends on staying fixed.

**Known limitation**: `200000` is hardcoded, not the live figure — the real budget scales with
that session's actual context window and the `skillListingBudgetFraction` setting. A session on
an extended context window has a real budget several times larger; Megatron can't know this at
scan time (it reads `~/.claude` offline). The sidebar's `used / 2,000` ratio is accurate for a
default-window session and overstates how "over budget" a skill listing is on a larger one.

## Linter rule set (all static)

| Rule                                                          | Applies to              | Algorithm                                                                                                                                                                                                                | Certainty                                                                                                     |
| --------------------------------------------------------------- | -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Missing or malformed YAML frontmatter (`yaml-frontmatter.ts`)  | Global, project         | No `---`...`---` block at all → "missing." Block found but `yaml.parse()` throws → "malformed," parser's own error message as `detail`                                                                                | Deterministic                                                                                                  |
| Empty or missing `description` (`missing-description.ts`)     | Global, project         | Only evaluated when frontmatter parsed successfully — `description` key absent, or present but empty/whitespace after trim                                                                                             | Deterministic                                                                                                  |
| Broken file path referenced in skill body (`broken-file-paths.ts`) | Global, project, plugin | Regex over the skill body: markdown link targets and backtick-quoted path-like spans. Resolve each candidate relative to the skill's own directory, `fs.existsSync()` it                                              | Heuristic — false positives/negatives both possible; best-effort, not a compiler                               |
| Referenced MCP server not present in user's MCP config (`missing-mcp-servers.ts`) | Global, project, plugin | Regex-scan for `mcp__([a-zA-Z0-9_-]+)__`, extract the server name. `mcp-config.ts` checks it against `~/.claude.json`'s top-level `mcpServers` (global) plus that same file's `projects[cwd].mcpServers`, and a project's own `.mcp.json`/`.claude/mcp.json` (project-scoped) | Heuristic on the "find the reference" side; the config-location lookup itself is deterministic                |
| Exact-name collision across sources (`name-collision.ts`)      | Global, project         | Reads the already-computed `shadowed_by_skill_id` on `SkillRow` (see Shadow detection below) — plugin skills are excluded since the plugin namespace structurally can't collide (`docs/skill-scanner.md`)              | Deterministic, cheapest rule by far                                                                            |

**Shadow detection** lives outside `lint_findings` entirely: a project skill shadowed by a
same-named global skill (dead, can never run) is distinct from two real, both-working project
skills in different repos (informational only). The shadow case is a live query in
`SKILLS_WITH_USAGE_SELECT` (`src/main/db/queries.ts`) plus a `shadowed_by_skill_id` field on
`SkillRow`; `name-collision.ts` simply reads that field rather than re-deriving a flat
`GROUP BY`.

## Scan cadence

Measured on this machine: 81MB across 146 transcript files, 17,411 total lines, only 41 Skill
`tool_use` calls (0.24% signal) — a full read-through was 0.066s of raw I/O. The cost scales with
lifetime history, not new activity, and most of that history is closed sessions whose mtime will
never change again. **Decision: mtime-skip, not a byte-offset cursor.**
`sessions_meta.source_mtime_ms` is compared via one `fs.statSync()` per file before parsing;
unchanged mtime skips the file entirely — simpler than a byte-offset cursor (no seek logic, no
truncation/rotation edge cases). The scan runs after the window is shown, not blocking
`app.whenReady()`. The main process emits `scan:complete` once it finishes; the renderer's
initial skills query polls on a short interval until that flag is set, then stops — this is what
drives the inventory's loading-skeleton state on first launch.

## Repo layout

```text
src/
├── main/                    # app lifecycle, ipc handlers, db, permissions
│   ├── index.ts
│   ├── permissions.ts       # isPathAllowed(), grantPath(), getGrantedPaths()
│   ├── theme.ts             # electron-store-backed theme + last-section persistence
│   ├── shell.ts             # shell:openExternal, scheme-validated
│   ├── skill-files.ts       # skills:open / skills:openMeta (file viewer content)
│   ├── plugin-actions.ts    # enable/disable/update/uninstall — shells out to `claude plugin <verb>`
│   ├── db/
│   │   ├── index.ts
│   │   ├── schema.ts
│   │   └── schema.sql
│   ├── ingest/
│   │   ├── skill-parser.ts       # shared: parse one skill dir's SKILL.md → {name, description} | fallback
│   │   ├── skills-scanner.ts     # global + project discovery, uses skill-parser.ts
│   │   ├── transcript-scanner.ts # session metadata + skill invocations
│   │   ├── plugin-registry.ts    # installed_plugins.json + marketplace diff, uses skill-parser.ts
│   │   └── scan-all.ts           # orchestrates a full scan across all four sources
│   └── linter/
│       ├── index.ts         # runs all rules over a scanned skill
│       ├── mcp-config.ts    # resolves the user's MCP server config
│       └── rules/            # one file per static rule (see Linter rule set above)
├── preload/                 # narrow typed bridge (contextBridge + ipcRenderer.invoke)
├── renderer/src/
│   ├── views/                # SkillInventory.tsx, SkillDetail.tsx, SkillFileViewer.tsx,
│   │                         # PluginInventory.tsx, PluginDetail.tsx
│   └── components/           # AppRail.tsx, Sidebar.tsx, ManageFoldersDialog.tsx, CommandPalette.tsx,
│                             # FileTree.tsx, MarkdownView.tsx, LintFindingsPanel.tsx,
│                             # PluginBadges.tsx, ui/ (shadcn)
└── shared/                  # ipc.ts — IPC channel names and shared row types
```

## Build milestones

**M0–M5 are shipped**: scaffold, Tier-1 ingestion, the skill inventory UI, Tier-2 folder consent,
the deterministic linter, and usage stats with per-skill token estimates and an aggregate context
budget are all live in the app today.

| #   | Name                | What                                                                                                                                     |
| --- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| M6  | Plugin remediation  | Version-compare against the marketplace cache for "Check for update"; deep-link to the marketplace repo's GitHub issues for "Report." The Plugins page (added 2026-08-24) ships this milestone's first slice: per-install `update` (shells out to `claude plugin update`) and version display, plus enable/disable/uninstall. The marketplace-cache version-compare and GitHub-issues deep-link are still open. |
| M7  | Ship                | Code-sign, notarize, DMG. No App Store submission lane. (`electron-builder.yml` currently has `notarize: false`.)                       |

## Deferred, on purpose

| Item                                                | Why not now                                                                                                                                                                                                            | Revisit when                                                                                          |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| In-app skill editing                                | Only write surface; a bug here corrupts a file Claude Code executes. `references/skills-manager`'s `audit_log.rs` (~80 lines: append-only SQLite table, best-effort writes, auto-pruned at 10k rows) is a template worth copying if built | Read-only inventory shows repeat weekly use                                                              |
| Semantic linter (unclear triggers, conflicting/duplicate skills) | Needs an LLM call — requires an API key and per-scan cost                                                                                                                                                             | Deterministic linter is stable and trusted                                                               |
| Full session content indexing                       | Would create a second copy of every prompt/tool-call ever made                                                                                                                                                        | A feature (replay, journal) needs message-level bodies, with its own privacy pass                        |
| Session replay / repo profile UI                    | Deliberately cut even though the index makes it near-free                                                                                                                                                             | Skills-only home screen proves the app earns repeat opens                                                |
| Fork-a-plugin-skill escape hatch                    | Adds a "diverged copy" model for one edge case                                                                                                                                                                        | Update + report proves insufficient for stuck/abandoned plugins                                          |
| Content-hash change detection for skill directories | M6's "check for update" is a version-string compare against the marketplace cache, not byte-level hashing. No committed milestone for a "modified since last scan" signal yet                                        | Same trigger as in-app skill editing. `references/skills-manager`'s `content_hash.rs:55-131` ignore-list is worth reusing if it lands |
| macOS App Sandbox                                   | Fights Electron's model; `~/.claude` sits outside any user-granted bookmark                                                                                                                                           | Mac App Store distribution becomes an actual goal — treat as a re-architecture, not a flag               |
| Windows / Linux builds                              | No audience OS data yet                                                                                                                                                                                               | Target-user OS split justifies it — Electron keeps this a CI change, not a rewrite                        |
| Cost analytics, MCP dashboard, knowledge graph, journal, coach, marketplace | Out of scope for this MVP entirely                                                                                                                                                                    | Per original roadmap's Phase 2+                                                                          |
| Built-in skills as a 4th source                     | Not user-managed state — no file, nothing to lint, no version to track                                                                                                                                                | Not expected to be revisited — cut, not deferred                                                          |
| Plugin component-inventory / token-cost analysis (Tier 2) | The Plugins page (2026-08-24) ships Tier 1 only — rollups of data already collected (skill count, aggregate invocations, aggregate lint findings). A fuller agents/hooks/MCP/LSP component inventory plus a projected token-cost split needs either `claude plugin details` text-parsing or a new Megatron-side scanner extending `plugin-registry.ts`'s pattern — neither exists yet | Tier 1 rollups prove insufficient for judging a plugin's real footprint |

## Still open

| Item                                       | Notes                                                                                          |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Pricing / monetization model               | Not discussed                                                                                       |
| Beta / early-access distribution mechanism | Not discussed                                                                                        |
