# Megatron: Scanner coverage gaps

Not a locked-decision doc. Originally a backlog note for two real skill locations the scanner
didn't read, found during the 2026-08-16 skill-name-collision planning session. Both are closed:

- **Gap 1 — nested `.claude/skills/` (monorepo subdirectories), closed 2026-08-18** — see
  `docs/skill-scanner.md`'s locked-decisions table (`findNestedSkillsDirs` /
  nested-skill name qualification rows) and `src/main/ingest/skills-scanner.test.ts`.
- **Gap 2 — `synced/` (claude.ai-synced skills), closed 2026-08-18** — see the same table's
  `synced/` row and `docs/data-model.md`'s `is_synced` shadowing note.

## Not investigated

Whether `.claude/commands/` (which [code.claude.com/docs/en/skills](https://code.claude.com/docs/en/skills)
says a skill always wins over on a name clash) should become a Megatron source at all is a
separate, bigger scope question — not a "gap" in the current three-source model, since commands
were never one of the three sources by design (`docs/skill-scanner.md`). Recorded here only so
it isn't conflated with the two closed gaps above if this doc is read out of context later.
