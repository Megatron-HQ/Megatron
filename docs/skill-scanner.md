# Skill scanner

Owns which directories count as skill sources, how they are walked, and how a `SKILL.md` is parsed,
token-estimated, and linted. `CLAUDE.md` stays authoritative for repo-wide decisions; the decisions
below are locked here.

Implementation: `src/main/ingest/` (`skills-scanner.ts`, `project-discovery.ts`,
`plugin-registry.ts`, `skill-parser.ts`) and `src/main/linter/`.

## Locked decisions

| Area                            | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Why                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Skill sources                   | Three: global (`~/.claude/skills`), project (`<repo>/.claude/skills`), plugin (each `~/.claude/plugins/installed_plugins.json` entry's `installPath`, probed for both `installPath/skills/<name>/SKILL.md` and a root `installPath/SKILL.md`)                                                                                                                                                                                                                                                                                                                       | Plugin skills are read-only: an update overwrites them. The two plugin shapes are a disk probe, not a manifest read, because `plugin.json`'s declared `skills` path doesn't match the installed cache: Claude Code's installer normalizes container-style plugins to a top-level `skills/`, and leaves single-skill root plugins (e.g. [blader/humanizer](https://github.com/blader/humanizer), `"skills": ["./"]`) as-is |
| `.agents/skills/`               | **Never** scanned. Permanently out of scope, not a v1 cut                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | It's a Codex convention, not a Claude Code artifact. Real repos carry both (`Portfolio/` has 11 same-named, diverged skills in each), so "Megatron missed a skill" is often the `.agents/` copy. This repo's own `.agents/skills/` mirror (`CLAUDE.md`) is unrelated housekeeping                                                                                                                                         |
| Symlinked skill dirs            | Followed only when both the discovered path and its canonical target are approved. Folder selection pins the canonical root; restoring a saved root never reapproves a retargeted junction                                                                                                                                                                                                                                                                                                                                                                          | External skill stores stay supported through an explicit grant of the target folder. See [security-hardening.md](security-hardening.md)                                                                                                                                                                                                                                                                                   |
| `synced/`                       | A reserved folder name (any capitalization) at any global or project root. Its children are skills with `is_synced = 1`, still `source_type 'global'`; the folder itself never is                                                                                                                                                                                                                                                                                                                                                                                   | [Claude Code docs](https://code.claude.com/docs/en/skills): claude.ai-synced skills download into `~/.claude/skills/synced/`, one level deeper than every other global skill                                                                                                                                                                                                                                              |
| Nested `.claude/skills/`        | Every `.claude/skills` below a granted repo counts, and shares the owning repository's `projectRoot`. A child `.git` directory or worktree file starts an independent repository (own settings, usage scope, and collision namespace), so a grant can cover a folder of several repos                                                                                                                                                                                                                                                                               | [Claude Code docs](https://code.claude.com/docs/en/skills): a monorepo package's own `.claude/skills/` loads even when the session started at the repo root. Invocation counts scope by `sessions_meta.cwd` under `project_root`, so packages must share their repo's root                                                                                                                                                |
| Nested-skill name qualification | `skills.name` holds a nested skill's bare name unless it collides with another same-named skill in the same repo; then it becomes `<posix-dir-from-repo-root>:<name>` (e.g. `apps/web:deploy`), forward-slashed on every OS. A colliding root-level skill keeps its bare name                                                                                                                                                                                                                                                                                       | Verified with three headless `claude -p` invocations (nested, no collision → bare; nested, colliding → qualified; root, colliding → bare). `skill_invocations` joins on this text with no FK, so it must match what Claude Code records. Two colliding nested skills with no root-level one follow by extrapolation, not independently verified                                                                           |
| Disabled skills                 | Read from `~/.claude/settings.json` and project settings. A plugin skill's `disabled_reason` comes from `enabledPlugins` at user scope. A global/project skill's `skillOverrides`: `off` → `disabled_reason = 'override'`; `user-invocable-only` → `model_invocable = 0`; `name-only` stays fully counted (a known residual: excluding it needs a name-token estimator). Project skills get the full `local > project > user` merge; global skills user scope only. A plugin skill's `model_invocable` comes from frontmatter `disable-model-invocation: true` only | Verified against [discover-plugins](https://code.claude.com/docs/en/discover-plugins.md), [skills](https://code.claude.com/docs/en/skills.md), and [settings-reference](https://code.claude.com/docs/en/settings-reference.md). User scope only for plugin/global skills is structural: those rows have `project_root = NULL`, one row total, so they can't represent "disabled in project X only"                        |

## Skill name precedence

Verified against [code.claude.com/docs/en/skills](https://code.claude.com/docs/en/skills) ("Where
skills live") 2026-08-16. When two skills share a name, Claude Code picks by source: enterprise,
then personal (global), then project. A personal skill wins over a same-named project skill in every
project, so the project one is unreachable while the personal one exists. Claude.ai-synced global
copies are the exception: a non-synced project skill outranks a synced copy.

Plugin skills are exempt: they're namespaced `plugin-name:skill-name`, so they can't collide with any
other skill. `docs/data-model.md` builds invocation attribution on this precedence.

## Scan integrity

Unreadable is not deleted. Every scanner and the discovery walk hold to this:

- An unavailable read (a skill file, settings, a project directory, an exhausted discovery budget)
  keeps the cached rows and reports a partial scan. Readable siblings still refresh.
- Cached rows are removed only when a child is confirmed missing beneath a readable parent. An
  unreadable or offline grant is no evidence about its children; an individually granted missing
  folder stays saved with its cached data.
- A malformed plugin registry entry keeps the affected identity; an unavailable marketplace or
  enablement snapshot keeps the previously known values.
- A scan never grants a location, guesses a moved project's new path, rewrites Claude's plugin
  registry, or moves historical usage to a guessed project identity.
- The repository catalog is derived metadata in the private preferences cache. It never grants
  access.

## Frontmatter parsing

The scanner and the linter both read `SKILL.md` frontmatter, for different purposes:

- **Scan time is best-effort.** A malformed `SKILL.md` still gets a `skills` row (directory name as
  `name`, `NULL` description); one bad skill never fails the scan.
- **Lint time is authoritative.** The linter re-parses each `SKILL.md` to produce rule-tagged
  findings, so the `skills` table holds no linter-only error state.
- **Parser: the `yaml` package.** A hand-rolled `key: value` splitter was rejected: it is permissive
  by construction, can't tell malformed frontmatter from simple frontmatter, and so defeats the
  "missing or malformed" rule.

## Token estimation

`est_listing_tokens` / `est_body_tokens` are `Math.round(text.length / CHARS_PER_TOKEN)` with
`CHARS_PER_TOKEN = 3`, an empirical calibration (2026-08-24): against Claude Code's own `/context`
per-skill counts across 25 skills, the binary's chars/4 averaged 74.6% of the real number
(`4 × 0.746 ≈ 3`).

Rejected: third-party tokenizers (Anthropic's token-counting docs: "Any estimate from tiktoken,
gpt-tokenizer, or similar is wrong for Claude"), and the `count_tokens` API, which would add a
network dependency and credentials to an offline, sub-second scan.

Four details any estimator must match:

- `Math.round`, not floor or ceil.
- JS string length, not UTF-8 byte length.
- A `null` description estimates `name` alone, not `name + ' '`.
- The description is capped at 1,536 chars before counting (the binary's
  `skillListingMaxDescChars`), or the estimate overstates long descriptions.

Claude Code truncates the skill listing at `contextWindow(200000) × 4 × 0.01` = 8,000 chars; that
`4` is its own internal constant, unrelated to ours. `CONTEXT_BUDGET_LIMIT` divides those 8,000
chars by `CHARS_PER_TOKEN` so `used` and `limit` stay in the same units.

`1536`, `0.01`, `200000`, and that inner `4` are undocumented detail from one build of Claude Code,
not a public contract: corroboration for Megatron's heuristic, nothing it depends on staying fixed.

**Known limitation:** `200000` is hardcoded. The real budget scales with the session's context
window and the `skillListingBudgetFraction` setting, which an offline scan can't know, so the budget
ratio overstates how "over" a listing is on an extended-context session.

## Linting

All rules are static; no API key.

| Rule                                  | Certainty                                                                                |
| ------------------------------------- | ---------------------------------------------------------------------------------------- |
| Missing or malformed YAML frontmatter | Deterministic                                                                            |
| Empty or missing `description`        | Deterministic                                                                            |
| Exact-name collision                  | Deterministic                                                                            |
| Broken file path in the skill body    | Heuristic: a regex over the body; false positives and negatives are both possible        |
| MCP server missing from user config   | Heuristic in finding the `mcp__<server>__` reference; the config lookup is deterministic |

Shadow detection lives outside `lint_findings`. A project skill shadowed by a same-named global
skill is dead; two same-named project skills in different repos both work and are informational
only. Shadowing is a live query (`shadowed_by_skill_id`) that the collision rule reads, rather than
a flat `GROUP BY` that can't tell the two apart.

## Not in scope

| Item                                                   | Why not                                                                                                                                                 | Revisit when                                                                                                            |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| In-app skill editing                                   | The only write surface on files Claude Code executes; a bug corrupts a skill. `references/skills-manager`'s `audit_log.rs` is the template if built     | The read-only inventory shows repeat weekly use                                                                         |
| Content-hash change detection                          | Plugin update checks are a version-string compare against the marketplace; nothing needs a "modified since last scan" signal                            | Same trigger as in-app editing. Reuse `references/skills-manager`'s `content_hash.rs` ignore list                       |
| Semantic linter (unclear triggers, overlapping skills) | Needs an LLM call: an API key and per-scan cost                                                                                                         | The deterministic linter is stable and trusted                                                                          |
| Fork-a-plugin-skill escape hatch                       | Adds a "diverged copy" model for one edge case                                                                                                          | Update plus Report ([#14](https://github.com/Megatron-HQ/Megatron/issues/14)) proves insufficient for abandoned plugins |
| Plugin component inventory and token-cost split        | The Plugins page shows rollups of data already collected. An agents/hooks/MCP/LSP inventory needs `claude plugin details` text-parsing or a new scanner | Rollups prove insufficient for judging a plugin's real footprint                                                        |
| Acting on an ungranted project/local install           | Without the folder grant the project's settings are unreadable, so status is Unknown and Enable/Disable would toggle a switch Megatron can't read       | Granting the folder proves to be friction users resent for an action they already confirmed                             |
| Built-in skills as a fourth source                     | **Cut**, not deferred: not user-managed state (no file, nothing to lint, no version)                                                                    | Not revisited                                                                                                           |
