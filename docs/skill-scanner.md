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

Checked against this machine's actual `~/.claude` (131 transcripts, 34 recorded Skill invocations, live `installed_plugins.json`) before scaffolding M1. Two things worth knowing if you're extending the scanners:

- **A 4th skill source exists in the wild, and it's not ours**: `Portfolio/.claude/skills/` and `Portfolio/.agents/skills/` both exist with 11 same-named-but-diverged skills. The `.agents/` copies are Codex's, not Claude Code's — permanently out of scope (see the `.agents/skills/` row above). If you're debugging "why didn't Megatron find this skill," check whether it's actually the `.agents/skills` variant before assuming the scanner is broken.
- **Skills dirs contain non-skill files** (e.g. a stray `summary.md` next to skill folders) — the scanner must key on `<dir>/SKILL.md` existing, not on every direntry.
