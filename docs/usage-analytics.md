# Usage analytics

Owns the data and accounting behind the Usage view: what "usage" means, which local sources feed
it, and how token and cost figures avoid double counting. `CLAUDE.md` stays authoritative for
repo-wide decisions; the decisions below are locked here.

Implementation: usage extraction rides the transcript walk in `src/main/ingest/` (`cost-parser.ts`,
`skill-cost-allocation.ts`, `prompt-history-scanner.ts`, `usage-history.ts`); Resident tax in
`src/main/context-usage.ts` and `src/main/ingest/recorded-request.ts`; queries in `src/main/db/`.
Read `docs/transcript-ingest.md` (the walk's dedup rules) and `docs/data-model.md` (the archive and
project identity) first.

## Locked decisions

| Area                     | Decision                                                                                                                                                         | Why                                                                                                                                                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Data source              | Mine transcripts and `~/.claude`, never a proxy                                                                                                                  | ~85% of the insight surface (cost, cache, model, trend, activity) is already local, with zero setup and full retroactive history. Same architecture Megatron already has                                       |
| No proxy process         | Megatron never runs a proxy and never sits in the auth-token path                                                                                                | A MITM on the OAuth token, and owning the "Megatron broke my Claude Code" failure mode, contradicts the read-only, one-scoped-write identity in `CLAUDE.md`                                                    |
| Stance                   | Insights-first and passive. No fabricated actions                                                                                                                | Megatron's job is insight; the user acts. A fake lever bolted onto "your cache hit rate is 91%" is worse than showing it well. Real levers arrive per insight, once the insight has earned its place           |
| Cost figures             | `cost-state.totalCostUSD` and per-model `costUSD` **verbatim only**. No price table, no bottom-up token pricing                                                  | Pricing from tokens is less accurate and breaks every model release, and bottom-up is where every accounting bug lives (see Double-counting hazards)                                                           |
| Cost copy                | "Estimated API-equivalent cost" / "what this would cost at pay-as-you-go API rates", with `/cost`'s "may not match your bill" disclaimer. Never "you spent"      | `totalCostUSD` is tokens × list price for subscription and API-key sessions alike, and most users are on subscription (real charge $0). In the one reconciled case it ran ~16% high against the actual invoice |
| No auth-regime split     | No surface distinguishes "real money" sessions from subscription ones                                                                                            | No auth marker exists anywhere local: not transcripts, `settings.json`, or `~/.claude.json`. `service_tier` is `"standard"` everywhere; message and request id prefixes are identical                          |
| `turn_usage` granularity | Per-turn rows for intra-session shape (model/effort counts, allocation weights) only. **Never summed for dollar totals**; session rollups come from `cost-state` | Summing per-turn `message.usage` over-counts ~2.3× (verified)                                                                                                                                                  |
| Organizing unit          | One standalone Usage view. Detail-page weaving and a session-centric view come later, in that order                                                              | The overview is what "insights on my context usage" means. Weaving scatters the story before the overview establishes it; session-centric has the narrowest audience                                           |
| Pre-feature history      | Sessions with no `cost-state` show "cost not tracked" and a visible excluded count, never an estimated dollar figure                                             | `cost-state` is version-gated (hazard 6). A rough flag on a number known to be ~2.3× off is worse than an honest gap                                                                                           |
| Resident tax source      | Totals from Claude Code's own `/context`, run headless from an empty folder, held in memory only. Detail from the newest interactive transcript, read on demand  | Transcripts can't reproduce `/context`'s categories, and global cache scope makes "cold session" sampling impossible. `/context` is local ($0, no API call), so the no-proxy rule holds                        |

## What "usage" means here

Two things share the name:

1. **`/usage` the command**: the live plan rate-limit gauge (5h window, weekly caps, reset times).
   Server-side. Megatron can't replicate it and shouldn't imply it can.
2. **Historical activity and cost**: what have I done, what did it cost, where is it going. Entirely
   local. This is what Megatron owns: a retrospective, not a gauge.

## Data sources

### Transcripts (`~/.claude/projects/**/*.jsonl`)

**Per assistant turn** (`type: "assistant"`): top-level `requestId`, `effort`
(`xhigh`/`high`/`medium`/`low`), `apiBlockIndex`, `message.model`, and `message.usage`:

| Field                                                        | Meaning                                                  |
| ------------------------------------------------------------ | -------------------------------------------------------- |
| `input_tokens`                                               | new, non-cached input                                    |
| `cache_creation_input_tokens` / `cache_read_input_tokens`    | cache write / read                                       |
| `cache_creation.ephemeral_1h_input_tokens` / `…_5m_…`        | the real 1h vs 5m cache-write split; don't assume all-1h |
| `output_tokens`                                              | total output                                             |
| `output_tokens_details.thinking_tokens`                      | a **subset** of `output_tokens`, already counted         |
| `service_tier`, `speed`                                      | `"standard"` everywhere observed                         |
| `server_tool_use.web_search_requests` / `web_fetch_requests` | billable per request                                     |
| `iterations[]`                                               | per-retry breakdown                                      |

**Session cost** (`type: "cost-state"`): `totalCostUSD`, `modelUsage[model]` →
`{ inputTokens, outputTokens, thinkingTokens, cacheReadInputTokens, cacheCreationInputTokens, webSearchRequests, costUSD }`,
`hasUnknownModelCost`, `startTime`, and peripheral durations and line counts.

**Lineage** (`type: "continued-in"`): `{ continuedInSessionId, sessionId }`, the resume/continue
link.

**Context-injection attachments** (`type: "attachment"`): `skill_listing` (the exact injected
listing text), `mcp_instructions_delta` (`addedBlocks`), `agent_listing_delta` (`addedLines`),
`deferred_tools_delta` (tool **names** only, never schemas), `hook_success` (hook-injected text),
`total_tokens_reminder`.

**Recorded requests** (Claude Code 2.1.300+): main transcripts carry `api-request-shape` (the exact
`system[]` blocks and full `tools[]` definitions, keyed by `shapeHash`) and `api-request`
(`querySource`, `cacheControl[]` breakpoints, `shapeHash`). Headless runs record `querySource: "sdk"`
and a different system prompt; only `repl_main_thread` describes an interactive session. Per-tool
token counts are still not recorded, nor how tools, system, and history sum to a billed
`input_tokens`.

### `~/.claude/history.jsonl`

Every prompt typed, with `project`, `sessionId`, `timestamp` (epoch ms), and `display` (raw text).
Verified 2026-09-05 (`claude` v2.1.261): Claude Code prunes entries older than `cleanupPeriodDays`
(default 30), the same sweep that ages out transcripts. Megatron never stores `display`.

### `~/.claude.json`

- `projects[<path>].lastCost` and its `last*` siblings: **don't use**. Only the most recent session
  per project, and observed `0`/empty for real multi-hour sessions.
- Top-level `skillUsage` (Claude Code's own per-skill counter), `pluginUsage`, `mcpServers`.
- `oauthAccount` describes only the **current** login; nothing per session or historical.

### Elsewhere

`~/.claude/usage-data/` holds Claude Code's own Insights output (`report.html`, per-session
`facets/*.json` LLM analysis). `~/.claude/telemetry/*.json` holds internal feature events. Neither is
read.

## Double-counting hazards

Verified 2026-09-05 against 53 tracked sessions. Any token or cost aggregation must clear all of
these; this is why cost reads `cost-state` rather than computing it.

1. **Never sum `message.usage` across lines.** Raw sum $278 vs `cost-state` $118.73 for the same
   sessions (2.3×): resumes replay prior history, sidechain lines, subagent files, and compaction
   re-include content.
2. **Resume/continue replay is not marked by `isSidechain`.** The invocation rule in
   `docs/transcript-ingest.md` doesn't cover it; the global turn identities do.
3. **`cost-state` carries forward across continued lineages.** A continued session's total
   includes its predecessor's, so only the lineage terminal (built from `continuedInSessionId`)
   counts.
4. **A file can hold several `cost-state` lines** (resume checkpoints; 9 of 53). Take the last: it
   is cumulative.
5. **Subagent cost is already inside the parent's `cost-state` total.** Pricing
   `subagents/*.jsonl` too double-counts.
6. **Version gate.** `cost-state` first appears in v2.1.241 (2026-08-21), is zeroed or partial until
   ~v2.1.246, and reliable from v2.1.247. A zeroed line is an immature-feature artifact, not a $0
   session: branch on presence.
7. **Model keys are inconsistent** (`claude-haiku-4-5-20251001` vs `claude-opus-5`). Normalize
   before any join.
8. **`<synthetic>`** appears as `message.model` on local/error messages: skip, no cost.
9. **`hasUnknownModelCost: true`** means Claude Code couldn't price a model (its baked-in price
   table went stale). Surface it as a caveat; it is the canary for a model newer than any price
   data.
10. **Repeated assistant records for one response repeat cumulative usage.** Keep per-counter
    maxima; never sum the duplicates.

## Is `cost-state` stable enough to build on?

Yes: the same risk class as the skill-invocation parsing Megatron already ships. Not a contract; a
reliable-enough signal that needs guards.

- **Not experimental.** It is behind no feature flag (`~/.claude.json` lists active experiments; it
  isn't one), appears in every substantive session from v2.1.246, backs features Anthropic keeps
  expanding (`/cost`, status-line cost, `/usage`), and exists to fix a cost-reset bug, so Claude Code
  itself depends on it.
- **Not an API.** Undocumented, with no published schema, and already rough (inconsistent model
  keys, one all-zeros record, a stale-price flag).

So:

- Store core fields only: `totalCostUSD`, per-model `costUSD` and token counts,
  `hasUnknownModelCost`. Peripheral fields may churn; read them ad hoc, never give them columns.
- `FROZEN_COST_STATE` in `cost-parser.test.ts` snapshots the shape, so a silent rename fails CI
  instead of shipping wrong dollars.
- Cost parsing shares the walk's single parser version (`docs/transcript-ingest.md`).

## Cost ingest

1. Read only the **last** `cost-state` line of each main transcript; never subagent files.
2. Store the `continued-in` link whether or not a `cost-state` exists. Every dollar aggregate
   filters to priced lineage terminals (the predicate is in `docs/data-model.md`).
3. A session with no `cost-state` gets no cost row. It counts as pre-tracking (before the first
   tracked session) or unusable (after it), never as a dollar figure.
4. A lineage terminal with no `cost-state` is unusable; it is never back-filled from a
   non-terminal in its chain.

## Per-skill cost attribution

Session cost isn't decomposable into the skills a session fired: sessions run several skills plus
unrelated work. The honest form is a **proportional estimate**, labelled as one, whose rows sum to
the real total:

- **Weight.** For each model in a session, split its `cost-state` `costUSD` across that model's
  turns by `output_tokens`, attribute each turn to its active skill, and sum per skill. A new model
  needs only its `costUSD` present.
- **Active skill.** A turn's `attributionSkill` when present; otherwise the last `Skill` call or
  slash trigger, sticky until the next. Accepted ceiling: this over-credits a fire-and-return skill
  for the turns after it.
- **Subagent turns count**, attributed to the skills invoked in that agent file, so subagent-run
  skills don't dump their cost into General work.
- **Lineage.** Turns roll up to the same priced terminal the cost totals use.
- **General work.** Turns with no active skill form one explicit bucket (`skill_name IS NULL`).
- **Unpriced lineages.** Invocations whose lineage has no usable priced terminal still count as
  activity, but contribute no dollars and never land in General work.

## Time placement

Rolling 24h/7d/30d windows (Cost, Skills, Tokens) aggregate **timestamped shares** of the recorded
terminal totals; nothing is placed by session start.

- Each share sits at its logical turn's time. Residual cost with no per-model breakdown spreads over
  the available turn times by output weight and shows as Unattributed. Cost with no turn timestamp
  stays in the all-history ledger and is disclosed as excluded from windows.
- **Tokens:** the headline is total tokens processed (new input + output + cache reads + cache
  writes; thinking is inside output). Recorded per-model terminal counters are authoritative. Each
  category spreads across that model's deduplicated response times by its own observed counts, then
  output weights, then equal weights; cumulative integer boundaries keep every category's total
  exact. Continuation ancestors and subagents supply timing weights, never extra totals. Every
  time-placed number is labelled estimated.
- Every rolling window, Activity's included, contains the exact cutoff and the as-of instant and
  excludes the future. Day buckets use local calendar days, daylight-saving changes included, and
  cover every date the window touches.

## Activity and History

- Activity and History read the same retained prompt archive (`usage-history.db`), with maximum
  observed prompt multiplicities and bare slash commands excluded, so their counts reconcile for
  identical intervals.
- Future dates, unavailable history, known empty days, and partially observed days stay distinct.
  Missing measurements are never synthesized as zeros, including to make panels list the same
  projects.
- Every project aggregate uses the identity and link rules in `docs/data-model.md`, applied without
  altering totals or source records.

## Stale skills

A skill is stale when it had 0 invocations in the last 30 days of covered history while it
existed. The inventory's icon tray marks it with the dormant `Clock` (`DESIGN.md`, Badges / Chips).
Every unknown resolves to no signal, because a missing icon costs less than a false one.

- **As-of anchoring.** The window is `[asOf − 30 days, asOf]`, where `asOf` is the latest
  `history_coverage.end_at`: the last successful prompt observation, not the wall clock. An app left
  open for days between scans never ages a skill past what the data has seen.
- **Global gates.** If any gate fails, nothing is stale:
  1. This launch's latest `scanTranscripts` and `archivePrompts` statuses are both `complete`. An
     index left over from a previous launch is never trusted. Inventory-only rescans don't run these
     sources, so the flags carry over between them.
  2. Archived prompt coverage spans the whole window.
  3. Every non-slash archived prompt in the window belongs to a session still in `sessions_meta`.
     Invocations come only from transcripts, which Claude Code prunes at `cleanupPeriodDays`
     (default 30, the same length as the window), so the archive's prompts supply the reach-back
     evidence. This gate catches a shorter retention, deleted transcripts, and any change to
     pruning. Bare slash commands never write a transcript, so they are left out.
- **Per skill.** A skill is stale only when all of these hold:
  - It is enabled and not shadowed. `Power` or the shadow warning already explains why such a skill
    doesn't run.
  - It existed before the window start. For global and project skills that is SKILL.md's birthtime
    (`skills.created_at`). For plugin skills it is the later of Megatron's first sighting
    (`history_plugin_skills`, recorded on every full scan) and the plugin's earliest current
    `installedAt`. The sighting catches a skill that an update added, since updates keep
    `installedAt`. `installedAt` catches an uninstall and reinstall after the sighting, and a
    missing one falls back to the sighting alone. A missing, unparseable, or epoch value (Node's
    fallback when a filesystem records no birthtime) gives no signal.
  - Its scope recorded non-slash prompts both before and during the window. The scope is every
    project for a global skill or a plugin with a `user`-scope install, the skill's own project for
    a project skill, and the install projects for a plugin with only `project` or `local` installs.
    Idle projects, idle months, and repos new within the window give no signal.
  - `last_invoked_at` is null or before the window start. It carries the invocation count's
    shadowing, project-scoping, and nested-root rules (`docs/data-model.md`).
- **Known limits.** Each one delays the signal; none produces a false one.
  - A git clone, a re-clone, or an editor's atomic save resets SKILL.md's birthtime.
  - Plugin skills get no `Clock` until 30 days after Megatron first records them, and that includes
    every plugin skill installed before the sighting table existed.
  - Reinstalling a plugin resets `installedAt`.
  - Headless `claude -p` runs write nothing to `history.jsonl`, so they never count as
    opportunity.
- Verified against real `~/.claude` 2026-11-11: of the 71 sessions with archived prompts in the
  window, 70 still had transcripts. The 71st held only a single bare slash command, which never
  writes a transcript.

## Resident tax

Claude Code marks the `system[1]` breakpoint `cache_control.scope: "global"`, so the prompt cache
is shared across sessions: 126 of 132 real sessions read 26k–43k cached tokens on turn 1. No
transcript is a "cold" sample, and transcripts can't produce `/context`'s categories (system
prompt, tool schemas, deferred tools) anyway. So the panel has two sources and stores neither:

- **Totals:** `claude -p "/context" --output-format json --no-session-persistence`, run with cwd
  `<userData>/context-baseline/`, a fixed empty folder, so the figure is the **global baseline** (no
  project CLAUDE.md, skills, or MCP servers). `/context` is computed locally: verified $0,
  `duration_api_ms: 0`, no transcript written, ≈3.6 s. It does start MCP servers and run
  SessionStart hooks. Run on the panel's first open per launch and on Refresh, held in memory.
  Parsed generically, so a category Claude Code adds later passes through. Rejected: `--bare`,
  which skips CLAUDE.md and hooks.
- **Per-item detail:** the first `repl_main_thread` request of the newest interactive transcript,
  read on demand. `sdk` and `-p` sessions are never used. Sizes are exact characters; the only
  tokens shown are `/context`'s own. Rejected: `chars/N` estimates, and `count_tokens`, which would
  put Megatron in the auth path.

## Not in scope

| Item                                                                                 | Why not                                                                                                                                                                                           | Revisit when                                                                                         |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Request capture (Phase 2b): tool-schema cut list, system-prompt sizing               | **Cut**, not deferred. Since 2.1.300, transcripts carry the full tool definitions and system prompt, and the Resident tax drill-in already ranks them by exact size. A capture layer adds nothing | Not revisited                                                                                        |
| Exact per-request composition (tools + system + history → billed `input_tokens`)     | Not recorded anywhere local, even in 2.1.300+ transcripts                                                                                                                                         | Claude Code records it locally                                                                       |
| Cache-efficiency ratio, 1h-vs-5m split, context-growth curve, tool-call distribution | Each needs careful per-turn dedup and still ships with a hedge badge: risk and permanent caveat copy for "huh, neat" numbers                                                                      | A specific number is wanted for a real decision                                                      |
| Lifetime cost total                                                                  | The version gate leaves most history untracked                                                                                                                                                    | `cost-state` coverage becomes near-complete as old sessions age out                                  |
| Rate-limit window % (`/usage`)                                                       | Server-side; not in local files                                                                                                                                                                   | Claude Code writes plan-limit state locally                                                          |
| Bottom-up token pricing                                                              | Strictly worse than `cost-state` (see Locked decisions)                                                                                                                                           | Full historical dollar coverage becomes a hard requirement; treat it as its own dedup-design project |
| Detail-page weaving (`SkillDetail` / `PluginDetail` gain usage numbers)              | Scatters the story before the overview establishes it                                                                                                                                             | The per-entity number becomes the top ask                                                            |
| Session-centric view (sessions list, per-turn drill-in)                              | The narrowest audience and the heaviest surface                                                                                                                                                   | Detail-page weaving shows users want to go deeper                                                    |
| Manual project linking UI                                                            | Removed with the Manage projects dialog; existing links still resolve                                                                                                                             | Users need to merge moved or re-cloned projects by hand                                              |
| Qualitative session analysis (`usage-data/`)                                         | A different feature (journal, coach)                                                                                                                                                              | A journal or coach feature is greenlit, with its own privacy pass                                    |
