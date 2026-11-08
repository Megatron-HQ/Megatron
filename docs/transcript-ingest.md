# Transcript ingest

Owns how `~/.claude/projects/**` transcripts become index rows: which records count, which are
skipped, how an invocation's origin is classified, and when a file is re-read. `CLAUDE.md` stays
authoritative for repo-wide decisions; the decisions below are locked here.

Implementation: `src/main/ingest/transcript-scanner.ts`; table shapes in `src/main/db/schema.sql`.

## On-disk shapes

Claude Code's own docs disclaim the transcript format as internal and versioned, so it can change
without notice: each line parses on its own and a malformed line is skipped, never fatal. Verified
against real transcripts:

- Main transcripts live at `~/.claude/projects/<project-dir>/*.jsonl`. Each subagent's conversation
  is a separate file at `<project-dir>/<sessionId>/subagents/agent-*.jsonl`, always one level deep,
  even when a subagent forks further. Its records carry the parent's `sessionId`.
- Every line carries top-level `timestamp`, `cwd`, `gitBranch`, `isSidechain`, and `sessionId`. Use
  `sessionId` (camelCase) only: a top-level `session_id` also appears and is not a duplicate.
- A `Skill` call is a `message.content[]` block with `type: "tool_use"`, `name: "Skill"`,
  `input.skill`, and `input.args`. Its `caller.type` is `"direct"` on every observed call, so nothing
  on the block distinguishes a user-explicit invocation from a model-triggered one.

## Locked decisions

| Area                    | Decision                                                                                                                                                                                                                  | Why                                                                                                                                                                                                                                                          |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Transcript double-count | Filter `isSidechain === false` on a main transcript's own lines. A `subagents/*.jsonl` file is read in full, tagged `trigger_type = 'subagent'`, under the parent's `session_id` with an `agent_id`                       | `isSidechain` marks sidechain records interleaved in a main transcript, which duplicate subagent work. A subagent file is 100% `isSidechain: true` by construction, so the flat filter would drop it entirely                                                |
| Cost is main-only       | Cost is extracted from main transcripts only, never from subagent files                                                                                                                                                   | A subagent's tokens are already inside the parent session's `cost-state` total (`docs/usage-analytics.md`, double-counting hazards); pricing subagent files too double-counts                                                                                |
| Global turn identity    | `turn_usage.logical_turn_key` and `source_uuid` are unique across the whole index, never scoped to `session_id`; a collision keeps one canonical row                                                                      | A resume/continue copies prior assistant records into a new session file without `isSidechain`, and a main/subagent pair can expose the same record twice. Per-session keys store the replay twice and corrupt model/effort counts and skill-cost allocation |
| One parser version      | `TRANSCRIPT_PARSER_VERSION` covers every consumer of the walk: invocations, session meta, `cost-state`, turns. Any semantic change to any of them, `cost-parser.ts` included, bumps it; there is no separate cost version | A bump forces one reindex of already-indexed history even when mtime and size are unchanged, so a newly supported format applies to old sessions, not just new writes                                                                                        |

## Scan cadence

**Decision: skip a transcript whose mtime and size are unchanged, rather than keep a byte-offset
cursor.** A session's freshness is the latest mtime across its main file and every subagent file. A
cursor would need seek logic and truncation/rotation handling for no measurable gain.

Evidence: one full read of 81 MB across 146 transcript files (17,411 lines, 41 `Skill` calls, 0.24%
signal) took 0.066 s of raw I/O. Cost scales with lifetime history, and most of that history is
closed sessions whose mtime never changes again.

## Invocation trigger classification

Origin (`user_invoked` vs `autonomous`) is recovered from the **nearest preceding user-role message
with string content**: the most recent such record while walking the transcript in order, which can
be several turns before the `Skill` call. User records whose `message.content` is an array carry
tool results, not typed text, and are skipped.

Three detection paths:

1. **`Skill` tool_use block.** `user_invoked` if the preceding message contains `/<skill-name>` as a
   word-boundary match (so `/grill-mean` doesn't match `/grill-me`); otherwise `autonomous`.
2. **Harness slash command.** A plain `user` record of the form
   `<command-message>…</command-message><command-name>/skill-name</command-name><command-args>…</command-args>`
   produces no `Skill` block at all. It is a real skill, not a built-in like `/clear`, only when its
   **direct child** (`parentUuid` match) contains `Base directory for this skill:`; no built-in ever
   produces that child. Verified across all local transcripts: 21 skill commands, 71 built-ins, 0
   false positives. Proximity instead of `parentUuid` misclassifies `/clear` whenever an unrelated
   record sits between. Always `user_invoked`.
3. **Automatic attribution.** Newer transcripts record a model-selected skill as root-level
   `attributionSkill` on an `assistant` record with no `Skill` block. Classified from the surrounding
   user turn; a slash-command or `Skill` record for the same skill and turn wins.

`preceding_user_text` keeps the text classification used. It recovers most `NULL` `args_text`
rows: the model omits `args` entirely when it self-triggers, which caused every observed `NULL`.

Accepted, not engineered around:

- **Cascade attribution.** One message can precede several `Skill` calls, so they share its text and
  its classification.
- **Image-caption stubs.** When the preceding message was an image, the text is a placeholder like
  `[Image: original 2438x1460...]`. Storage stays raw.
- **No time-window dedup.** Invocations dedupe on the transcript line's `uuid`. Claude Code's own
  `skillUsage` counter in `~/.claude.json` applies a 60-second window, so the two can differ by
  design.

## Integrity

- A changed session's main transcript and every subagent file must read and parse completely before
  any of its cached metadata, invocations, costs, or turns are replaced. An incomplete or unavailable
  read leaves the previous rows and freshness markers intact and makes the scan partial.
- Corrupt recorded costs reject that session's snapshot rather than overwrite valid prior costs.
- When a rescan or retention cleanup removes a canonical turn or invocation, a replay of it (parsed
  this scan, or read from an unchanged transcript) takes its place. Only matching replays are
  restored, so a turn removed from its sole source stays deleted, and a failure reading replay
  evidence rolls back the whole scan.

## Not in scope

| Item                              | Why not                                                               | Revisit when                                                                      |
| --------------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Recursive walk below `subagents/` | `subagents/` is verified flat                                         | A transcript nests subagent files deeper                                          |
| Full session content indexing     | It would create a second copy of every prompt and tool call ever made | A feature (replay, journal) needs message-level bodies, with its own privacy pass |
| Session replay / repo profile UI  | Deliberately cut even though the index makes it near-free             | The skills-first app proves it earns repeat opens                                 |
