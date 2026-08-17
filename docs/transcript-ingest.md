# Megatron: Transcript ingest

Owns how `~/.claude/projects/**` transcripts become `skill_invocations` rows — which records
count, which are skipped, and how an invocation's origin is classified. `CLAUDE.md` stays
authoritative for repo-wide decisions; the decision below is locked here.

Implementation: `src/main/ingest/transcript-scanner.ts`. Table shapes live in
`docs/data-model.md`.

## Locked decisions

| Area                    | Decision                                                                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Transcript double-count | Filter `isSidechain === false` on a **main** transcript's own lines; a dedicated `subagents/*.jsonl` file is read in full instead, tagged `trigger_type='subagent'` |

**Why**: `isSidechain` marks inline sidechain records interleaved in a main transcript (still
excluded there, to avoid double-counting). Separately, Claude Code writes each subagent's own
conversation to `<sessionId>/subagents/agent-*.jsonl` — a wholly different file, 100%
`isSidechain: true` by construction, that the old flat `isSidechain === false` rule would have
dropped entirely rather than double-counted. `scanTranscripts` walks one level into that
directory per session; those files' records inherit the parent's `sessionId`, so invocations
land under the parent's `session_id` with an `agent_id` column identifying the fork.

## Invocation trigger classification (added post-M1, simplified post-M2)

M1 shipped, then a real-data investigation of `NULL` `args_text` rows (see mvp-build-spec's
Revisions section) found that invocation _origin_ is recoverable from the **nearest preceding
user-role message with string content**, even though it isn't recoverable from the `Skill`
tool_use block itself. Algorithm:

1. Preceding message contains `/<skill-name>` as a substring, word-boundary-checked (so
   `/grill-mean` doesn't false-match `/grill-me`) → `user_invoked`.
2. Else → `autonomous`.

"Preceding" means most-recently-seen `type: 'user'` record with **string** content while
walking a transcript's records in order — not literally the previous line. A triggering
message can be several assistant/tool-result turns before the actual `Skill` call (observed
directly: `visual-verify` fired several lines after the relevant user turn). User-role records
whose `message.content` is an **array** (tool-result-carrying "user" lines, not actual typed
text) are correctly skipped by this check — they don't overwrite the last real message seen.

Implementation lives in `transcript-scanner.ts` as a small pure function, not a new shared
file — unlike `skill-parser.ts`, this has exactly one consumer, so no shared-helper file is
warranted. `extractInvocations` changes from a stateless per-record loop into a stateful
forward scan tracking the last seen string-content user message.

**Known, accepted heuristic limitation**: this is "most recent user text before this
invocation," not proven causality. If one message triggers a cascade of several skill calls
across many turns, a later call in that cascade is still attributed to the same original
message even if it's arguably less directly caused by it. Same category of limitation as the
linter's file-path/MCP-reference heuristics — not something to engineer around.

**Correction (post-M2): the original three-way split (`harness_command` | `text_mention` |
`autonomous`) collapsed to two (`user_invoked` | `autonomous`).** The original design treated
a harness-parsed `<command-name>/skill-name</command-name>` tag and a bare `/skill-name`
mid-prose as separately meaningful categories. A fresh real-data sweep (broader than the
original — every transcript across every project on this machine, not just the ones scanned
at the time, 54 real invocations total) found **zero** `harness_command` rows, same as the
original spot check (0 out of 43 then). The original doc entry attributed this to `harness_command`
being "legitimately unobserved so far" — rare, but real and reachable. That attribution was
wrong. The actual cause: a genuine harness-native `/skill-name <args>` invocation (the CLI's
own slash-command syntax, typed as the entire prompt) **never produces a `Skill` tool_use
block at all.** Concretely: the transcript instead shows a `user`-role record with string
content `<command-message>...</command-message><command-name>/skill-name</command-name>
<command-args>...</command-args>`, immediately followed by a _separate_ `isMeta: true`
user-role record whose array content is the skill's injected system prompt — no `tool_use`
step in between. Confirmed against six independent real transcripts, including one in this
repo's own history. So `harness_command` wasn't a rare-but-real bucket waiting to be observed
— it was structurally unreachable by this detection method from the start, because the two
things `classifyTrigger` needs (a `<command-name>` tag _and_ a `Skill` tool_use to attach it
to) never co-occur for a true harness command. What _was_ actually being recorded as
`text_mention` with `args_text: null` in every real case checked (10/10 for one recurring
plugin skill) was the model itself, on seeing a bare `/skill-name` mention typed mid-message,
choosing to call the `Skill` tool with no `args` field — a real, distinct mechanism from the
harness's own command routing, correctly flagged as user-triggered either way. Given
`harness_command` could never fire, keeping a three-way enum around it was unrequested
complexity; collapsing the two user-triggered shapes into one `user_invoked` value is a
straight simplification, not a loss of real signal — `args_text` still carries whatever the
model chose to pass along.

**Gap closed (post-M2, was "still-open")**: true harness-native command invocations were
**completely invisible to the scanner** — no `skill_invocations` row was created for them at all,
because `extractInvocations` only looked for `Skill` tool_use blocks. The
`<command-name>`/`<command-args>` shape (a plain `user` record, no `isMeta` on the command line
itself — that only appears on the synthetic marker record injected after it) carried real
skill-name and args data that went unindexed entirely.

Fixed with a second detection path in `extractInvocations`, reading `<command-name>`/
`<command-args>` off the harness-command `user` record directly. The hard part wasn't detection,
it was exclusion: a `/clear` or `/model` produces the identical `<command-name>` shape, and
naive proximity (e.g. "look at the next record or two") misclassifies `/clear` as a skill whenever
an unrelated record sits between it and a real command — confirmed in real data
(`a5f1f238…jsonl`). The reliable signal, verified against all 131 local transcripts (21 real skill
commands, 71 built-ins, 0 false positives either direction): a genuine skill command's own
**direct child** (`parentUuid` match, not proximity) carries the literal text `Base directory for
this skill:`; no built-in ever produces that child. `skill_name`/`trigger_type`
(`user_invoked`)/`args_text` all come from the command record itself — no schema change needed.

**Implemented and verified.** Full lint/typecheck/test gate green after the collapse.

**Second gap closed (post-M2): subagent-invoked skills.** A 15 Aug 2026 audit comparing ground
truth (parsed independently from every Aug-15-touching transcript) against the live db found the
scanner captured 14 of 15 real invocations. The miss: a skill invoked _inside_ a subagent
(Task/Agent fork), which was invisible for two independent reasons — `scanTranscripts` only reads
`*.jsonl` files directly under a project directory, never descending into
`<sessionId>/subagents/agent-*.jsonl` where Claude Code writes each fork's own transcript; and even
if it did, every record in those files carries `isSidechain: true`, which `extractInvocations`
drops on a main transcript's own lines (see the Locked decisions section above).

Verified on disk before fixing (7 session dirs, 14 subagent files, 671 records): `subagents/` is
always flat — no nesting, even when a subagent itself spawns a further fork, its children land in
the same flat directory — so a one-level-deeper walk is sufficient. 100% of subagent-file records
are `isSidechain: true`. Every record carries the **parent's** `sessionId` and `cwd`, which is the
trap: naively reusing `parseTranscript()` on a subagent file would upsert a `sessions_meta` row
keyed on the parent's id populated from the subagent's own `started_at`/`message_count`, silently
corrupting the parent's real session row rather than just missing data.

Fixed with `parseSubagentInvocations()`, which parses a subagent file and calls
`extractInvocations()` with that file's `agentId` — deliberately never calling `extractSession()`.
`extractInvocations` now takes an `agentId: string | null` parameter: when non-null, it skips the
`isSidechain` guard (nothing to double-count in a dedicated subagent file) and forces
`trigger_type: 'subagent'` on every invocation found, regardless of which detection path (slash
command or `Skill` tool_use) matched — flattening away whatever `user_invoked`/`autonomous`
distinction the same logic would otherwise compute, since inside a fork no human typed anything.
`scanTranscripts` walks each session's `subagents/` directory (via `allowedReaddirSync`/
`allowedStatSync`, the existing permission chokepoint) and computes freshness as
`max(parent mtime, all subagent mtimes)`, so a subagent finishing after the parent's last scan
still triggers a rescan. Subagent invocations carry the parent's `session_id` (already true of the
raw data), so the existing retention sweep (`DELETE ... WHERE session_id NOT IN (...)`) needs no
changes to clean them up when a session is deleted.

**Schema change**: `skill_invocations.trigger_type` CHECK widened to
`('user_invoked', 'autonomous', 'subagent')`, and a new nullable `agent_id TEXT` column added
(the subagent's filename stem, e.g. `agent-a5738f0e768b82c34`; `NULL` for main-session rows). No
migration path exists (`applySchema` is `CREATE TABLE IF NOT EXISTS` only — see the forward-looking
gap in `docs/data-model.md`), so this rides on a fresh local db rather than an `ALTER TABLE`.

**Not in scope**: no renderer/IPC surface reads `trigger_type` yet, so `'subagent'` doesn't appear
in the UI. No general recursive directory walk — the one-level-deeper `subagents/` check is
sufficient per the verified-flat structure above, and adding more would be solving a problem that
doesn't exist in real data.

**Third gap closed (M5): `preceding_user_text` recovers most `NULL` `args_text` rows.** A
measurement across all 211 real transcripts on this machine found `args_text` is `NULL` on 36%
of invocations overall (27% of `user_invoked` rows, 44% of `autonomous` rows) — this refines the
"10/10 for one recurring plugin skill" spot-check above, which didn't reproduce at full scale;
that anecdote was a small, non-representative sample. Root cause is clean and singular: the
model omits the `args` key entirely when self-triggering. 100% of the `NULL` rows are that one
shape — no empty strings, no non-string values, no truncation.

The fix reuses a value `extractInvocations` already computes and previously discarded: the
nearest preceding user-role message with string content (the same `precedingMessage` variable
`classifyTrigger` reads). Stored as `skill_invocations.preceding_user_text`, populated only on
the `Skill` tool_use detection path — the slash-command path stores `NULL`, since there
`precedingMessage` has already been assigned the command record's own content and storing it
would duplicate what `args_text` captures, not add ambient context. Truncated to 2000 chars on
capture (observed max 4225, p90 929 — the field is unbounded by construction, so the cap is
defensive, not a reaction to the data). Recovers values for 97% of the `NULL` `args_text` rows.

Two known-imprecise properties, both accepted rather than engineered around:

- **Cascade attribution** (same limitation as `trigger_type` above): 22% of recovered values are
  shared across multiple invocations, because one triggering message can precede several
  `Skill` calls.
- **Image-caption stubs**: 9% of recovered values are placeholders like
  `[Image: original 2438x1460, displayed at 2000x1198...]` — the preceding message was an
  attached image, not text. Real and common, not a parsing bug. Filtered with a
  `NOT LIKE '[Image:%'` predicate at query time (`getSkillUsageDetail` in `src/main/db/queries.ts`)
  rather than at write time, since storage stays raw as a historical fact regardless of whether
  a given UI surface wants to display it.

**Validation**: cross-checked Megatron's `total_invocations` count against Claude Code's own
internal counter (`jq '.skillUsage' ~/.claude.json`) for a handful of skills. `grill-me` (56),
`visual-verify` (18), and `test-driven-development` (8) matched exactly. The one skill that
didn't match exactly is explained by a 60-second dedup window in Claude Code's own counter, which
Megatron deliberately doesn't replicate (`skill_invocations` dedupes on the transcript line's own
`uuid`, not on a time window — a real design difference, not a bug in either counter).

**Schema mechanics**: `skill_invocations` was designed immutable/append-only
(`INSERT OR IGNORE`, no update path — see the Idempotency section in `docs/data-model.md`)
specifically because its original columns are true, unchanging facts about what happened.
`trigger_type` stayed consistent with that design rather than becoming a carved-out exception:
rather than back-filling the 42 already-indexed rows via a guarded `ALTER TABLE` + forced full
rescan (seriously considered, including the exact SQL), the simpler and equally valid move —
given this is pre-ship, no real user has a `megatron.db` yet — was deleting the local dev
database and letting a fresh scan repopulate everything with `trigger_type` computed from the
start. This is the literal "delete my local index is a `rm`" principle from `docs/data-model.md`,
applied to a real case instead of just the local dev database's own accidental drift. The
`ALTER TABLE`-on-existing-tables gap flagged there is _still_ real and _still_ deferred to M7 —
this was a case where deleting was legitimately simpler, not a precedent that migrations are
never needed.
