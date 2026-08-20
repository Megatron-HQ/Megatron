# Skill scanner — sources, symlinks, and real `~/.claude` data notes

Owns which directories count as skill sources and how they are walked. `CLAUDE.md` stays
authoritative for repo-wide decisions; the decisions below are locked here.

Implementation: `src/main/ingest/skills-scanner.ts`, `plugin-registry.ts`.

## Locked decisions

| Area                 | Decision                                                                                                                                                               | Why                                                                                                                                                                                                                                                                                                                                                                                                                              |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Skill sources        | Three sources: global (`~/.claude/skills`), project (`<repo>/.claude/skills`), plugin (`~/.claude/plugins/installed_plugins.json` → each entry's `installPath/skills`) | Plugin skills are read-only — silently overwritten on update                                                                                                                                                                                                                                                                                                                                                                     |
| `.agents/skills/`    | **Never** scanned — permanently out of scope, not a v1 cut                                                                                                             | It's a Codex convention, not a Claude Code artifact. Megatron is a Claude Code tool; this isn't "deferred," it's out of scope by definition. Don't add it as an opt-in source without an explicit, separate decision to do so. (This repo's own `.agents/skills/` is still kept in sync as a generated mirror — see `CLAUDE.md`. That's repo housekeeping, unrelated to what the scanner reads.)                                 |
| Symlinked skill dirs | Followed, not rejected — `isPathAllowed()` checks the symlink's own path, never resolves or validates its target                                                       | This is how symlink-sync tools (e.g. `references/skills-manager`, whose default sync mode is symlink) lay skills out under `~/.claude/skills/`; the scanner's flat, non-recursive walk means `existsSync` transparently follows the link. Rejecting escaped targets would blind Megatron to every symlink-installed skill, not harden anything — read the symlink tests in `skills-scanner.test.ts` before ever "hardening" this |
| `synced/` (claude.ai-synced skills, closed 2026-08-18) | `synced` (any capitalization) is a reserved folder name at any global/project root — `scanSkills()` special-cases an entry that lowercases to `synced`, descends one level via `readAllowedDirectory`, and applies the same `SKILL.md`-existence check to its children instead of testing `synced/` itself. Those rows get `is_synced: 1` and keep `source_type: 'global'` (no new enum value — see `docs/data-model.md`). The reconciliation write also pushes `<root>/synced` into that scan's `rootDirs`, since a synced skill's `dirname` is one level below the scanned root. | [code.claude.com/docs/en/skills](https://code.claude.com/docs/en/skills): Claude Code downloads claude.ai-synced skills into `~/.claude/skills/synced/`, one level deeper than every other global skill; the folder name itself is never a skill. Was `docs/scanner-coverage-gaps.md`'s Gap 2, now closed — see that doc for what's still open. |
| Nested `.claude/skills/` (monorepo packages, closed 2026-08-18) | `findNestedSkillsDirs(repoRoot)` recursively finds every `.claude/skills` below a granted repo's own subdirectories (the top-level `<repoRoot>/.claude/skills` is still constructed unconditionally in `defaultSkillRoots()`, independent of disk state), feeding `scanSkills()` one `SkillRoot` per discovery — all sharing the granted repo's `projectRoot`, never the nested subdirectory, since invocation counts scope by `sessions_meta.cwd` under `project_root` and sessions run at the repo root. Unbounded depth; skips `node_modules`, `.git`, `dist`, `build`, `out`, `coverage`, `vendor`, `target`, `.next`, and `.claude` itself (so a skill's own reference/example files can't be mistaken for a real nested package). Cycle-guarded via `allowedRealpathSync` (visited-realpaths set). | [code.claude.com/docs/en/skills](https://code.claude.com/docs/en/skills): a monorepo package's own `.claude/skills/` loads even when the session started at the repo root. Was `docs/scanner-coverage-gaps.md`'s Gap 1, now closed. |
| Nested-skill name qualification | `skills.name` holds a nested skill's **bare** name unless it collides with another same-named skill in the same repo (root-level or another nested one) — then it's rewritten to `<posix-relative-dir-from-repoRoot>:<bare-name>` (e.g. `apps/web:deploy`), always forward-slashed regardless of host OS. A colliding **root-level** skill of that name always keeps its bare name. | Verified against real transcript data, not assumed from the docs page: three headless `claude -p` invocations (nested-no-collision → bare; nested-colliding → qualified; root-level-colliding → still bare) confirmed the exact conditional rule Claude Code itself applies — see `qualifyCollidingNestedSkillNames` in `skills-scanner.ts`. `skill_invocations` joins on this text with no FK (`docs/data-model.md`), so it has to match what Claude Code actually records or usage counts misattribute. Two nested collisions with no root-level skill at all follow the same mechanism by extrapolation from those three cases, not independently re-verified. |

## Skill name precedence (verified against official docs, 2026-08-16)

From [code.claude.com/docs/en/skills](https://code.claude.com/docs/en/skills), "Where skills
live": when two skills share a name, Claude Code picks one by source, in this order — enterprise,
then personal (global, `~/.claude/skills/`), then project (`.claude/skills/`). A personal skill
always wins over a same-named project skill, in every project, unconditionally — the project one
becomes permanently unreachable while the personal one exists with that name.

Plugin skills are exempt from all of this: they're namespaced as `plugin-name:skill-name`, so a
plugin skill structurally can't collide with a global, project, or another plugin's skill. This is
also why the `plugin_name` composite identity (`docs/data-model.md`) never needed to account for
name collisions.

This precedence is what `docs/data-model.md`'s "Skill name collisions" section builds the
invocation-attribution rules on — see that doc for how `total_invocations` handles a shadowed
project skill.

## Real `~/.claude` data notes

Checked against this machine's actual `~/.claude` (131 transcripts, 34 recorded Skill
invocations, live `installed_plugins.json`) before scaffolding M1. Two things worth knowing if
you're extending the scanners:

- **A 4th skill source exists in the wild, and it's not ours**: `Portfolio/.claude/skills/` and
  `Portfolio/.agents/skills/` both exist with 11 same-named-but-diverged skills. The `.agents/`
  copies are Codex's, not Claude Code's — permanently out of scope (see the `.agents/skills/` row
  above). If you're debugging "why didn't Megatron find this skill," check whether it's actually
  the `.agents/skills` variant before assuming the scanner is broken.
- **Skills dirs contain non-skill files** (e.g. a stray `summary.md` next to skill folders) — the
  scanner must key on `<dir>/SKILL.md` existing, not on every direntry.
