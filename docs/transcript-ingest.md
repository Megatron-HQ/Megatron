# Megatron: Transcript ingest

Owns how `~/.claude/projects/**` transcripts become `skill_invocations` rows — which records
count, which are skipped, and how an invocation's origin is classified. `CLAUDE.md` stays
authoritative for repo-wide decisions; the decisions below are locked here.

Implementation: `src/main/ingest/transcript-scanner.ts`. Table shapes live in
`docs/data-model.md`.

## Locked decisions

| Area                    | Decision                                                                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transcript double-count | Filter `isSidechain === false` on a **main** transcript's own lines; a dedicated `subagents/*.jsonl` file is read in full instead, tagged `trigger_type='subagent'` |

**Why**: `isSidechain` marks inline sidechain records interleaved in a main transcript (excluded
there, to avoid double-counting). Separately, Claude Code writes each subagent's own conversation
to `<sessionId>/subagents/agent-*.jsonl` — a wholly different file, 100% `isSidechain: true` by
construction, which the old flat `isSidechain === false` rule would have dropped entirely rather
than double-counted. `scanTranscripts` walks one level into that directory per session (verified
flat — no nesting, even when a subagent itself forks further); those files' records inherit the
parent's `sessionId`, so invocations land under the parent's `session_id` with an `agent_id`
column identifying the fork.

`parseSubagentInvocations()` parses a subagent file and calls `extractInvocations()` with that
file's `agentId`, deliberately never calling `extractSession()` — reusing `parseTranscript()`
naively would upsert a `sessions_meta` row keyed on the parent's id but populated from the
subagent's own `started_at`/`message_count`, corrupting the parent's real session row.
`extractInvocations` takes an `agentId: string | null`: when non-null, it skips the `isSidechain`
guard (nothing to double-count in a dedicated subagent file) and forces `trigger_type:
'subagent'` regardless of which detection path matched. `scanTranscripts` computes freshness as
`max(parent mtime, all subagent mtimes)`, so a subagent finishing after the parent's last scan
still triggers a rescan. Subagent invocations carry the parent's `session_id`, so the existing
retention sweep (`DELETE ... WHERE session_id NOT IN (...)`) needs no changes to clean them up.

## Invocation trigger classification

Origin (`user_invoked` vs `autonomous`) isn't recoverable from the `Skill` tool_use block's own
fields, but it is recoverable from the **nearest preceding user-role message with string
content** — "preceding" meaning most-recently-seen `type: 'user'` record with string content
while walking a transcript in order, not literally the previous line (a triggering message can be
several turns before the actual `Skill` call). User-role records whose `message.content` is an
array (tool-result-carrying "user" lines, not typed text) are skipped by this check.

Three detection paths, all populating `skill_name`/`trigger_type`/`args_text`:

1. **`Skill` tool_use block.** Classify via the preceding-message rule: if it contains
   `/<skill-name>` as a word-boundary substring (so `/grill-mean` doesn't false-match
   `/grill-me`) → `user_invoked`; else → `autonomous`.
2. **Harness-native slash command.** A plain `user` record whose string content is
   `<command-message>...</command-message><command-name>/skill-name</command-name>
<command-args>...</command-args>` never produces a `Skill` tool_use block at all — this shape
   has no `tool_use` step to attach a classification to, so it needs its own detection path. The
   reliable signal (verified against all local transcripts, 21 real skill commands / 71 built-ins
   / 0 false positives): a genuine skill command's own **direct child** (`parentUuid` match, not
   proximity — proximity misclassifies `/clear` whenever an unrelated record sits between it and
   a real command) carries the literal text `Base directory for this skill:`; no built-in ever
   produces that child. `skill_name`/`args_text` come from the command record itself,
   `trigger_type` is always `user_invoked`.
3. **Automatic attribution.** Newer transcripts can record a skill the model selected
   automatically as root-level `attributionSkill` on an `assistant` record, with no `Skill`
   tool-use block. Indexed generically for any non-empty skill name, using the surrounding user
   turn to classify `user_invoked` vs `autonomous`. Repeated attribution records for the same
   skill in one user turn collapse to one row. If a canonical slash-command or `Skill` tool-use
   record already exists for that same skill and turn, it wins and the attribution record is
   suppressed.

`skill_invocations.preceding_user_text` stores the value the first path already computes for
classification (`NULL` on the slash-command path, since there `precedingMessage` is already the
command's own content and storing it would duplicate `args_text`). Truncated to 2000 chars on
capture (observed max ~4200, unbounded by construction — the cap is defensive). Recovers most
`NULL` `args_text` rows (the model omits `args` entirely when self-triggering — that's the sole
cause of every observed `NULL`).

Two known-imprecise properties of `preceding_user_text`, both accepted rather than engineered
around:

- **Cascade attribution**: one triggering message can precede several `Skill` calls, so a
  meaningful share of recovered values are shared across multiple invocations — same category of
  limitation as the `trigger_type` heuristic above.
- **Image-caption stubs**: a smaller share of recovered values are placeholders like
  `[Image: original 2438x1460...]` when the preceding message was an attached image, not text —
  real and common, not a parsing bug. Filtered with a `NOT LIKE '[Image:%'` predicate at query
  time (`getSkillUsageDetail` in `src/main/db/queries.ts`), since storage stays raw regardless of
  whether a given UI surface wants to display it.

**Validation**: `total_invocations` cross-checked against Claude Code's own internal counter
(`jq '.skillUsage' ~/.claude.json`) for a handful of skills — matched exactly except one,
explained by a 60-second dedup window in Claude Code's own counter that Megatron deliberately
doesn't replicate (`skill_invocations` dedupes on the transcript line's own `uuid`, not a time
window — a real design difference, not a bug in either counter).

`sessions_meta.transcript_parser_version` is part of the scan cache — a parser-semantic change
bumps the named parser version, forcing one safe reindex even when the transcript's mtime/size
are unchanged, so a newly-supported transcript format applies to already-indexed history, not
just future writes.

## Schema

`skill_invocations.trigger_type` CHECK: `('user_invoked', 'autonomous', 'subagent')`. Nullable
`agent_id TEXT` column (the subagent's filename stem, e.g. `agent-a5738f0e768b82c34`; `NULL` for
main-session rows). `applySchema` rebuilds legacy `skill_invocations` safely when its
`trigger_type` CHECK doesn't admit all three values, preserving existing rows; its session-cache
migrations also add `source_size_bytes` and `transcript_parser_version` for pre-existing local
indexes. Consistent with `docs/data-model.md`'s "delete, don't migrate" policy — the standard
move for a schema change here is `npm run db:reset` + relaunch, not an in-place migration.

## Not in scope

No renderer/IPC surface reads `trigger_type` yet, so `'subagent'` doesn't appear in the UI. No
general recursive directory walk — the one-level-deeper `subagents/` check is sufficient per the
verified-flat structure above.
