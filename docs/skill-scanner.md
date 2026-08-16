# Skill scanner — real `~/.claude` data notes

Checked against this machine's actual `~/.claude` (131 transcripts, 34 recorded Skill invocations, live `installed_plugins.json`) before scaffolding M1. Two things worth knowing if you're extending the scanners:

- **A 4th skill source exists in the wild, and it's not ours**: `Portfolio/.claude/skills/` and `Portfolio/.agents/skills/` both exist with 11 same-named-but-diverged skills. The `.agents/` copies are Codex's, not Claude Code's — permanently out of scope (see `CLAUDE.md`'s Locked decisions table). If you're debugging "why didn't Megatron find this skill," check whether it's actually the `.agents/skills` variant before assuming the scanner is broken.
- **Skills dirs contain non-skill files** (e.g. a stray `summary.md` next to skill folders) — the scanner must key on `<dir>/SKILL.md` existing, not on every direntry.
