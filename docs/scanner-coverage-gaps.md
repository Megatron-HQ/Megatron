# Megatron: Scanner coverage gaps

Not a locked-decision doc. A backlog note: two real skill locations the scanner currently
never reads, found during the 2026-08-16 skill-name-collision planning session (see
`docs/skill-scanner.md` and `docs/data-model.md` for the collision-handling work these gaps
were split out of). Neither is folded into that work — recorded here so a future session can
pick either up on its own.

Both gaps trace to the same root cause: `scanSkills()` in `src/main/ingest/skills-scanner.ts`
does one flat, non-recursive `readdirSync(root.dir)` per root and keys a hit on
`<root.dir>/<entryName>/SKILL.md` existing (skills-scanner.ts:43-64). Anything requiring a
second level of directory nesting below `root.dir` before reaching a real `SKILL.md` is
invisible to it.

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

## Gap 2 — `synced/` (claude.ai-synced skills)

> The folder name `synced` is reserved in the enterprise, personal, and project skills
> locations, in any capitalization. Claude Code downloads the skills you enable on claude.ai
> into `~/.claude/skills/synced/` when `CLAUDE_CODE_SYNC_SKILLS` is set in non-interactive mode.

A synced skill lives at `~/.claude/skills/synced/<skill-name>/SKILL.md` — one level deeper than
every other global skill. `scanSkills()`'s flat walk checks `~/.claude/skills/synced/SKILL.md`
(doesn't exist — `synced` itself is never a skill) and stops there; it never descends into
`synced/` to find the real per-skill directories underneath. Result: synced skills are silently
absent from the inventory today, not merely unlabeled.

Precedence-wise (same docs page): "A skill or command from any of these sources overrides a
skill synced from your claude.ai account with the same name" — synced skills are the
lowest-priority source. Worth knowing if/when this gap is picked up, since it means a synced
skill can itself be shadowed by a personal/project/enterprise skill of the same name, same
general shape as the global-shadows-project case already being designed for.

## Not investigated

Whether `.claude/commands/` (which the same docs page says a skill always wins over on a name
clash) should become a Megatron source at all is a separate, bigger scope question — not a
"gap" in the current three-source model, since commands were never one of the three sources by
design (`docs/skill-scanner.md`). Not recorded as a gap here; flagging only so it isn't
conflated with the two above if this doc is read out of context later.
