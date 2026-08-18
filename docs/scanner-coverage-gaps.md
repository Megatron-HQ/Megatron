# Megatron: Scanner coverage gaps

Not a locked-decision doc. A backlog note: real skill locations the scanner currently never
reads, found during the 2026-08-16 skill-name-collision planning session (see
`docs/skill-scanner.md` and `docs/data-model.md` for the collision-handling work these gaps
were split out of).

**Gap 2 (`synced/`) closed 2026-08-18** — see `docs/skill-scanner.md`'s locked-decisions table
and `docs/data-model.md`'s `is_synced` shadowing note. Gap 1 is still open, recorded below.

Both gaps trace to the same root cause: `scanSkills()` in `src/main/ingest/skills-scanner.ts`
does one flat, non-recursive `readdirSync(root.dir)` per root and keys a hit on
`<root.dir>/<entryName>/SKILL.md` existing. Anything requiring a second level of directory
nesting below `root.dir` before reaching a real `SKILL.md` is invisible to it.

Source for both: [code.claude.com/docs/en/skills](https://code.claude.com/docs/en/skills)
("Where skills live" section), fetched and quoted 2026-08-16.

## Gap 1 — nested `.claude/skills/` (monorepo subdirectories)

> Skills also load from nested `.claude/skills/` directories below your working directory.
> When Claude reads or edits a file in a subdirectory, skills from that subdirectory's
> `.claude/skills/` become available. This lets a monorepo package provide its own skills that
> apply when working on that package, even if the session started at the repo root.
>
> If a nested skill shares a name with another skill, both stay available... The nested one
> appears under a directory-qualified name, `apps/web:deploy`.

Megatron's project-tier scan only ever reads `<granted-repo>/.claude/skills/*` — never
`<granted-repo>/**/​.claude/skills/*`. A repo with package-scoped skills (any monorepo using this
feature) is under-inventoried today: those skills exist, run, and get invoked in real
transcripts, but `skills-scanner.ts` never finds their `SKILL.md` files, so they never get a
`skills` row.

Notable because it's a *third* shape of "same short name, different skill" — distinct from
both collision axes the 2026-08-16 session scoped (cross-repo project/project, and
global-shadows-project): here two skills coexist deliberately, in the same repo, disambiguated
by Claude Code itself via directory-qualified names. Worth reading together with whatever the
collision-handling plan lands on, since the identity model (`source_path` as the unique key)
already generalizes to this case for free — the actual work is purely in the scanner walk
(recursing into subdirectories, deciding a depth bound, and deciding whether to store/display
the directory-qualified name `apps/web:deploy` Claude Code itself would use).

## Gap 2 — `synced/` (claude.ai-synced skills) — CLOSED 2026-08-18

Was a flat-walk blind spot identical in shape to Gap 1 (one extra level of nesting under
`~/.claude/skills/synced/<skill-name>/SKILL.md`), plus a lowest-priority precedence rule.
Resolved: `scanSkills()` special-cases `synced/` and tags its rows `is_synced: 1`; precedence is
a second `WHEN` branch in the shadowing subquery. See `docs/skill-scanner.md`'s locked-decisions
table and `docs/data-model.md`'s "Skill name collisions" section for the closed design, and
`src/main/ingest/skills-scanner.test.ts` / `src/main/db/queries.test.ts` for the tests.

## Not investigated

Whether `.claude/commands/` (which the same docs page says a skill always wins over on a name
clash) should become a Megatron source at all is a separate, bigger scope question — not a
"gap" in the current three-source model, since commands were never one of the three sources by
design (`docs/skill-scanner.md`). Not recorded as a gap here; flagging only so it isn't
conflated with the two above if this doc is read out of context later.
