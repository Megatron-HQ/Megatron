# Megatron: Usage analytics

Owns the design for surfacing a user's Claude Code **activity, token, and cost history** —
"what have I been doing, what did it cost, where is it going." `CLAUDE.md` stays authoritative
for repo-wide decisions; the decisions below are locked here.

**Status:** Phase 2a in progress — PR1 (Activity), PR2 (Cost), PR3 (Skills), and PR4
(Model & effort + proportional attribution) have landed; PR5 remains design-only.
This is the Phase-2 feature that `docs/mvp-build-spec.md`'s "Deferred, on purpose" row _"Cost
analytics, MCP dashboard … Per original roadmap's Phase 2+"_ was pointing at.

**Phase 2a is in progress.** **PR1 — Activity — landed** (2026-09-05): the "Usage" top-level
section, its page frame, and the Activity retrospective over `~/.claude/history.jsonl`.
**PR2 — Cost — landed**: `cost-state` ingest (`session_cost` / `session_model_cost`, riding the
existing transcript walk) and the Cost section of the Usage view. **PR3 — Skills — landed**
(2026-09-09): 24h/7d/30d skill activity, trigger mix, trends, and the explicitly non-attributive
session association table (`getSkillStats`, `skill_invocations` ⋈ `session_cost`, no new ingest) —
association rows click through to skill detail, and a section caption reports priced sessions that
fired no skill. Renderer decisions for the whole Usage view are locked in
**`docs/usage-view-ui-spec.md`**. PR5 (Resident tax) remains design-only.

**Canonical PR sequence** (reconciles the build-order table below and `usage-view-ui-spec.md`,
which have historically disagreed on numbering — the build-order `#` is a dependency order, not a
PR number):

| PR  | Scope                                                                       | Status      |
| --- | --------------------------------------------------------------------------- | ----------- |
| PR1 | Activity                                                                    | ✅ landed   |
| PR2 | Cost                                                                        | ✅ landed   |
| PR3 | Skills section — 24h/7d/30d activity, trend, trigger mix, association table | ✅ landed   |
| PR4 | `turn_usage` + Model & effort section + the proportional-attribution rider  | ✅ landed   |
| PR5 | Resident tax — attachment parsing, fresh-session detection                  | design-only |

**Implementation:** usage extraction in `src/main/ingest/` (riding `transcript-scanner.ts`'s
existing walk), derived-cache tables in `src/main/db/`, and a new top-level renderer view.
Consult `docs/transcript-ingest.md` (the scan/dedup rules this builds
on) and `docs/data-model.md` (schema conventions) first.

---

## Delivery phases

| Phase  | What                                                                                                                                                                                | New runtime surface                                                                        |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **2a** | Transcript + `~/.claude` mining. The "Usage" view, Tier 1 insights + proportional skill attribution. **PR1–4 landed**; PR5 design-only. Renderer spec: `docs/usage-view-ui-spec.md` | None — same derived-cache model as today                                                   |
| **2b** | Opt-in request-capture enrichment: the tool-schema "cut list" + system-prompt sizing                                                                                                | Reads capture files from a **granted** directory; ships a **user-launched** capture script |

---

## Locked decisions

| Area                     | Decision                                                                                                                                                                                                 | Why                                                                                                                                                                                                                                                  |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Data-source foundation   | Transcript + `~/.claude` mining, **not** a proxy. Proxy-captured request bodies are a 2b enrichment layer only                                                                                           | ~85% of the insight surface (all cost/cache/model/trend/activity data) is already in `~/.claude` for **zero setup** and **full retroactive history**. Same architecture Megatron already has                                                         |
| No proxy process         | Megatron **never runs a proxy and never sits in the auth-token path**. 2b reads capture files from a granted dir; the shipped `scripts/capture-proxy.mjs` is user-launched                               | A MITM on the OAuth token, and owning the "Megatron hung and broke my Claude Code" failure mode, contradicts the read-only + one-scoped-write identity in `CLAUDE.md`                                                                                |
| Capture-tool coupling    | 2b depends on the **Anthropic Messages request schema** (`*.request.txt` = the raw request body), not on any capture tool's output format. Never parse a third party's rendered markdown                 | The capture tool (Matt Pocock's gist proxy, our fork, a future `claude --dump-requests`) stays swappable                                                                                                                                             |
| Stance                   | Insights-first, **passive**. No fabricated actions                                                                                                                                                       | Megatron's core job is insight; the user acts. Bolting a fake lever onto "your cache hit rate is 91%" is worse than showing it well. Real levers (disable skill/hook, MCP cut list) arrive later, per-insight, once the insight has earned its place |
| Cost figures             | `cost-state.totalCostUSD` / per-model `costUSD` **verbatim only**. No price table in the codebase. No bottom-up token pricing                                                                            | Rolling our own from tokens is strictly worse — less accurate _and_ a price-table maintenance burden that breaks every model release. See "Double-counting hazards" — bottom-up is where every accounting bug lives                                  |
| Cost copy                | "Estimated API-equivalent cost" / "what this would cost at pay-as-you-go API rates". **Never** "you spent" / "you were charged". Mirror `/cost`'s "may not match your bill" disclaimer                   | `totalCostUSD` is tokens × list price, computed identically for subscription and API-key sessions. Most Megatron users are on subscription — real charge $0. It also ran ~16% high vs the actual invoice in the one reconciled case                  |
| No auth-regime split     | Do not design a surface that distinguishes "real money" sessions from subscription sessions                                                                                                              | **No auth marker exists anywhere local** — not transcripts, `settings.json`, or `~/.claude.json`. `service_tier` is `"standard"` everywhere; msg/req id prefixes identical                                                                           |
| `turn_usage` granularity | Per-turn table, for **intra-session shape only** (context-growth curve, per-turn model/effort). A hard "never summed for totals" contract. Session rollups come from `cost-state`, derived at query time | Summing per-turn `message.usage` over-counts ~2.3× (verified). Per-turn data is still the right home for the proxy-like depth, and `requestId` is the seam to 2b captures                                                                            |
| Organizing unit          | Standalone **"Usage" view** first. Detail-page weaving (`SkillDetail`/`PluginDetail` gain real numbers) and a session-centric view come later, in that order                                             | The single overview is what "insights on my context-window usage like the proxy" actually means, and the natural home for the 2b cut list. Detail-page weaving scatters the story; session-centric is the narrowest audience                         |
| Pre-feature history      | Sessions with no `cost-state` line show **"cost not tracked"** + a "Claude Code added cost tracking Aug 2026" note + a visible excluded-session count. No estimated dollar figure for them               | `cost-state` is version-gated (see hazards). A "loud rough flag" on a number known to be ~2.3× off is worse than an honest gap                                                                                                                       |

---

## What "usage" means here

Two different things share the name:

1. **`/usage` the command** — the live plan rate-limit gauge (5h window, weekly caps, % of limit
   left, reset times). **Server-side** — it comes from the API. Megatron structurally cannot
   replicate it, and shouldn't imply it can.
2. **Historical activity + cost analytics** — "what have I done, what did it cost, where's it
   going." **Entirely local.** This is what Megatron owns.

Megatron's surface is a retrospective, not a gauge.

---

## Data sources

### Transcripts — `~/.claude/projects/**/*.jsonl`

`transcript-scanner.ts` already walks these for `skill_invocations` + `sessions_meta` and drops
everything else on every line. What's there and unused:

**Per assistant turn** (`type:"assistant"`) — top-level `requestId` (the join key to 2b
captures), `effort` (`xhigh`/`high`/`medium`/`low`), `apiBlockIndex`, `message.model`, and
`message.usage`:

| field                                                        | meaning                                                         |
| ------------------------------------------------------------ | --------------------------------------------------------------- |
| `input_tokens`                                               | new, non-cached input                                           |
| `cache_creation_input_tokens` / `cache_read_input_tokens`    | cache write / read                                              |
| `cache_creation.ephemeral_1h_input_tokens` / `…_5m_…`        | real 1h vs 5m cache-write split — don't assume all-1h           |
| `output_tokens`                                              | total output                                                    |
| `output_tokens_details.thinking_tokens`                      | **subset** of `output_tokens` — already billed, never add again |
| `service_tier`, `speed`                                      | `"standard"` everywhere observed                                |
| `server_tool_use.web_search_requests` / `web_fetch_requests` | billable per request                                            |
| `iterations[]`                                               | per-retry breakdown                                             |

**Session end** (`type:"cost-state"`, always the last line — but see hazards):
`totalCostUSD`, `modelUsage[model]` → `{inputTokens, outputTokens, thinkingTokens,
cacheReadInputTokens, cacheCreationInputTokens, webSearchRequests, costUSD}`,
`hasUnknownModelCost`, `startTime`, `totalAPIDuration`, `totalAPIDurationWithoutRetries`,
`totalToolDuration`, `totalDuration`, `totalLinesAdded`, `totalLinesRemoved`.

**Lineage** (`type:"continued-in"`): `{continuedInSessionId, sessionId}` — resume/continue link.

**Context-injection attachments** (`type:"attachment"`), the measurable resident-context parts:

| `attachment.type`        | payload                                                                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `skill_listing`          | the **exact skill-listing text as injected** — measure real listing tokens, not the `chars/3` estimate                                                                   |
| `mcp_instructions_delta` | `addedBlocks` — full MCP instruction text per server                                                                                                                     |
| `agent_listing_delta`    | `addedLines` — full subagent listing                                                                                                                                     |
| `deferred_tools_delta`   | `addedNames`/`removedNames`/`readdedNames`/`wireHiddenNames` (tool **names** in/out of context), `failedMcpServers`, `pendingMcpServers` — **names only, never schemas** |
| `hook_success`           | hook-injected text (e.g. the entire Ponytail block — the measurable cost of one SessionStart hook)                                                                       |
| `total_tokens_reminder`  | running budget snapshots                                                                                                                                                 |

**Tool calls** (`content[].tool_use`, `toolUseResult`) — every call name + input (only `Skill`
parsed today), result shapes (`stdout`/`stderr`, `structuredPatch`, `gitOperation`, images), the
frequency distribution, tool-error rate.

### `~/.claude.json`

- `projects[<path>]` → `lastCost`, `lastModelUsage`, `lastTotal*Tokens`, `lastSessionMetrics`,
  `lastFpsAverage`/`lastFpsLow1Pct`. **DO NOT USE** — only the most recent session per project,
  and observed `0`/empty even for real multi-hour sessions. Transcripts are the source of truth.
- top-level `skillUsage` (CC's own per-skill counter — `docs/transcript-ingest.md` already
  cross-checks it), `pluginUsage`, global `mcpServers`.
- `oauthAccount` — only the **current** login (`billingType`, `organizationType`,
  `hasExtraUsageEnabled`). Not per-session, not historical.

### `~/.claude/history.jsonl`

Every prompt typed, with `project`, `sessionId`, `timestamp` (epoch ms), and `display` (the raw
prompt text). Prompt volume, prompts/day, project split, busiest hours & weekdays. (This is what
CC's own insights report counts.)

**Retention (verified 2026-09-05, `claude` v2.1.261):** `history.jsonl` is not permanent — Claude
Code prunes entries older than `cleanupPeriodDays` (default **30 days**), the same retention sweep
that ages out transcripts (`getCutoffDate()` → `now − cleanupPeriodDays × 24h`). So any mirror of
it is capped at ~30 days by design; the Activity view's rolling 7d/30d windows sit inside that.
**Long-range** prompt history would need an _accumulating_ store, explicitly exempt from the
derived-cache invariant (`docs/data-model.md`), plus a privacy pass — a separate feature, not
folded into Phase 2a.

**PR1 schema** (`prompt_history`, `src/main/db/schema.sql`) — wiped and reloaded whole each Scan,
**no prompt text stored**:

```sql
CREATE TABLE IF NOT EXISTS prompt_history (
  session_id TEXT NOT NULL,          -- history.jsonl sessionId; NO FK — spans pruned sessions
  project TEXT NOT NULL,             -- raw cwd string, matches sessions_meta.cwd
  typed_at TEXT NOT NULL,            -- epoch ms -> ISO 8601 UTC
  is_slash_command INTEGER NOT NULL  -- 1 = bare ^/[a-z][\w-]*$ (/clear, /quit); heuristic
);
```

`is_slash_command` is computed once at ingest so the Activity "prompts" count can exclude bare
tool-control commands without the prompt text ever entering the Index. The `^/[a-z][\w-]*$` regex
also catches a real skill run typed with no args (`/visual-verify`) — ~1% of lines, in the
conservative direction (slightly undercounts prompts); a `skill_invocations` join to disambiguate
is out of PR1 scope.

### `~/.claude/usage-data/`

CC's own **Insights** feature output: `report.html` (qualitative — what's working, friction,
quick wins, bar charts) and `facets/<session-id>.json` (per-session LLM analysis:
`underlying_goal`, `goal_categories`, `outcome`, `user_satisfaction_counts`, `friction_counts`,
`session_type`, `brief_summary`). Out of scope for the first cut but a real source if a
qualitative angle is ever wanted.

### `~/.claude/telemetry/*.json`

`ClaudeCodeInternalEvent` events (feature usage, env, betas). Low priority.

### What NONE of these have — 2b / capture only

1. **Full tool JSON schemas + their exact byte/token size** ("Artifact tool = 37,621 B ≈ 9,405
   tok ≈ 12.3% of the request"). Transcripts have tool _names_, never `input_schema`.
2. **The system prompt** (the "You are Claude Code…" identity, ~15 KB / ~3,900 tok). Roughly
   constant, so one capture ≈ all captures — but still capture-only.
3. **The exact assembled request** — ordering, `cache_control` breakpoints, how tools + system +
   history sum to a specific billed `input_tokens`.
4. `count_tokens` housekeeping calls.

---

## Double-counting hazards (verified 2026-09-05)

Any bottom-up token aggregation must clear all of these. This is the whole reason the locked
decision is "read `cost-state`, don't compute."

1. **Never sum `message.usage` across `.jsonl` lines.** Cross-check: raw sum = $278 for the same
   53 sessions `cost-state` totals at $118.73 (**2.3×**). Causes: resumed sessions replay prior
   history as context; inline sidechain lines; `<sessionId>/subagents/*.jsonl` turns; compaction
   re-including summarized content.
2. **Resume/continue replay is _not_ marked by `isSidechain`.** The existing
   `isSidechain === false` + dedicated-subagent-file rule (`docs/transcript-ingest.md`) handles
   _invocation_ counting; the cost path has this extra hazard it doesn't cover.
3. **`cost-state` itself double-counts across continued lineages.** `continued-in` marker:
   `a0172855` ($1.32) → `70a66d1d` ($2.27), and `70a66d1d`'s total _carries forward_ `a0172855`'s
   cost. Rule: build the lineage via `continuedInSessionId`, count **only the terminal session**.
   Secondary signal: `cost-state.startTime` later than the session's first-line timestamp ⇒
   replayed history ⇒ probably a continue.
4. **9 of 53 sessions have multiple `cost-state` lines** (resume checkpoints within one file).
   Always take the **last** — it's cumulative, not per-segment.
5. **Subagent token cost is already inside the parent's `cost-state` total.** Reading parent
   `cost-state` _and_ pricing `subagents/*.jsonl` double-counts. Pick one basis: top-down
   `cost-state` (recommended) **or** bottom-up with full dedup — never both.
6. **Version gate.** `cost-state` first appears CC **v2.1.241** (2026-08-21 in this data), zeroed
   / partial until ~**v2.1.246**, reliable **v2.1.247+**. Here: 53 of ~234 sessions have it.
   `045738f4` (v2.1.241, 247 turns) has a `cost-state` line with **everything zeroed** — an
   immature-feature artifact, _not_ a $0 session. Branch on presence.
7. **Model-key formatting is inconsistent:** `claude-haiku-4-5-20251001` (date suffix) vs
   `claude-sonnet-5` / `claude-opus-5` (none). Normalize before any join.
8. **`<synthetic>`** appears as `message.model` on local/error messages — skip, no cost.
9. **`hasUnknownModelCost: true`** ⇒ CC couldn't price a model (the price table is baked into the
   CLI binary and goes stale). Surface it; don't silently trust `totalCostUSD`. It's the canary
   for a model newer than any price data.

---

## Is `cost-state` stable enough to build on?

**Verdict: yes — same risk class as the skill-invocation parsing Megatron already ships.** Not a
contract; a reliable-enough signal that needs a fallback and a fixture guard.

**Why it's not experimental:**

- **No feature gate.** `~/.claude.json` carries active experiments (`tengu_copper_fox`,
  `tengu_flint_harbor`, …); `cost-state` is not one. It appears in 100% of substantive sessions
  from v2.1.246+ — no rollout %, no flag. Shipped infra, not a trial.
- **It backs features Anthropic is actively expanding** — `/cost`, status-line cost/duration
  fields, `/usage`, `/skill-doctor`, `~/.claude/usage-data/` reports. The changelog trend is
  _more_ cost visibility every release, not less.
- **It exists to fix a bug** (v2.1.246: cost/duration resetting to zero after navigating to the
  agents view and back) — persisting this tally is now load-bearing for CC's own correctness
  across resume / `--clear` / view-switch.

**Why it's still not a stable API:**

- **Undocumented.** No published schema, not in the changelog. A field rename / cadence change /
  relocation won't be treated as "breaking" because there's no contract.
- **Already rough** — inconsistent model keys in one object, one all-zeros degenerate record
  observed (`045738f4`), `hasUnknownModelCost` exists precisely because the baked-in price table
  goes stale.

**What that means for the build (folded into the ingest rules and build order below):**

1. **One parser version for the whole transcript walk, cost included.** Cost-state extraction
   rides `scanTranscripts`, so it shares `sessions_meta.transcript_parser_version`
   (`docs/transcript-ingest.md`) — a cost-parser-semantic change bumps that single constant and
   forces a one-time reindex of history, not just new writes. There is **no separate
   `cost_parser_version`** (as-shipped decision, PR2): a separate version only isolates risk when
   the walks are separate, and they are not. PR2 bumped it `3 → 4`.
2. **Core fields only.** `totalCostUSD`, per-model `costUSD`, per-model token counts,
   `hasUnknownModelCost`. Peripheral fields (`totalLinesAdded`, `totalAPIDuration`,
   `totalToolDuration`, `startTime`) are nice-to-have that may churn — **do not make schema
   columns you'd have to migrate for.** (The repo's "delete, don't migrate" policy softens this,
   but the smaller the surface, the fewer silent-wrong-number bugs.)
3. **Fixture-snapshot the `cost-state` JSON shape** in a test, so a silent field rename fails
   loudly in CI instead of producing wrong dollar figures in the UI.
4. `hasUnknownModelCost` gating and the "no `cost-state`" path (below) are required regardless —
   they also make the feature resilient if the format shifts.

---

## The cost investigation that produced this doc (reference)

A parallel Claude session reconciled the user's history against the Anthropic Console while this
design was being grilled. Findings, for context:

- The user received **$100** in promo API credit (granted when Fable was removed from the Pro
  plan), then ran some Claude Code sessions under **API-key auth** and burned through it. Console:
  **$99.67 spent, $0.33 left.**
- Local `cost-state` across the 53 tracked sessions totals **$118.73** — **~16–19% high** vs the
  real invoice. Likely drivers: all cache-creation priced at the 1h rate (2×), API prompt-cache
  economics differ from the flat calc, rounding.
- The dollar-bearing sessions form one unbroken run **2026-08-21 → 2026-09-05 05:44**, then a
  hard stop — the shape of an API key configured for that window and removed. **88%** of the spend
  is Megatron work; **76%** is the Sept 3–4 push.
- **Calibration:** the 183 pre-feature (subscription) sessions estimate to **~$1,174**
  API-equivalent by the same math. The user obviously didn't pay that — which is the proof that
  `cost-state` / `/cost` means _"what this would cost at API rates,"_ not a charge ledger.
- **There is no way to reconcile to the cent locally**, and no way to tell a real-money session
  from a subscription one. Point users at `console.anthropic.com` → Usage (toggle Cost) +
  Billing → Credits, and at `/status` (current auth) / `/cost` (running charge, says outright
  when a session is subscription).

See the auto-memory note `cost_state_dollar_estimates.md` for the compressed version.

---

## Insight menu (full brainstorm)

Everything considered, by robustness. The first cut is Tier 1 + the Tier 3 association table
(marked ✅); the rest is deferred (see "Deferred").

### Tier 1 — robust, from data already there ✅

| Panel                     | Question it answers                                                                                                              | Source                                                                                                         |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Activity**              | sessions, messages, active days, prompts/day, busiest hours & weekdays, per-project split                                        | `history.jsonl` + `sessions_meta`                                                                              |
| **Cost (tracked window)** | per-session $ cards, window total, per-model $ split, per-project $ ranking                                                      | `cost-state` verbatim — lineage-collapsed, last-line-only                                                      |
| **Skill activity**        | invocations over 24 h / 7 d / 30 d, top skills, trend, user-invoked vs autonomous vs subagent, plus the Tier-3 association table | `skill_invocations` (already ingested) ⋈ `session_cost` for the association table                              |
| **Model & effort mix**    | which model served your turns, `xhigh`/`high`/`medium`/`low` distribution                                                        | per-turn `model` / `effort` — **counts, not sums**                                                             |
| **Resident context tax**  | measured total from a fresh session's turn-1 context + the itemizable parts (skill listing, hooks, MCP instructions — all exact) | turn-1 `cache_creation_input_tokens` + `skill_listing` / `hook_success` / `mcp_instructions_delta` attachments |

### Tier 2 — needs careful dedup, would ship with an "estimate" badge

- Token volume 7 d / 30 d (output, cache-creation) — deduped sum by `uuid`, main-transcript only
- Cache-efficiency ratio + 1h-vs-5m cache-write split
- Context-growth curve _within_ one session
- Tool-call distribution (Read ×71, Bash ×32 …) + tool-error rate

### Tier 3 — the "which skill costs what" angle

Session cost is **not decomposable** into the skills a session invoked (a session fires several
skills _and_ does unrelated work; skills co-occur). The honest form is **association, not
attribution**:

> "Sessions that invoked `visual-verify`: 12 sessions · $18 est. · 40 turns · 2.1 M output tok"

✅ **landed as PR3** — a labelled association table (`getSkillStats`), riding
`skill_invocations` ⋈ `session_cost`, no new ingest, plus two `skill_invocations` indexes.
Columns: Skill · Tracked / all sessions · Output tokens · Associated cost. It must **never** be
captioned "this skill cost you $18"; the section caption states the double-counting mechanism,
never a ratio.

**Ceilings accepted in PR3:**

- **Naive column sums past the real total** (a $200 tracked window can show ~$290 across the
  rows) — a session firing N skills is counted under all N. The caption states the mechanism;
  it never prints the overlap ratio. PR4's rider replaces this with proportional attribution.
- **Association numbers are windowed by invocation date** (24h / 7d / 30d), but
  `pricedSessionsWithoutSkill` — the "N sessions fired no skill" caption count — spans **all**
  cost-tracked history, like `getCostStats`, which also ignores the toggle. Both are stated in
  the caption.
- **Lineage-forward resolution, not a drop.** An invocation that lands only in a non-terminal
  session is resolved forward through `continued_in_session_id` to its priced terminal and
  credited there (`resolvePricedTerminal`). This is the deliberate replacement for PR2-era
  `getSkillCostAssociation`'s inner-join drop; it keeps the association consistent with how
  `getCostStats` treats lineages.
- **A session with no usable cost lineage** (zeroed terminal, broken or cyclic `continued-in`
  chain, or no `cost-state` at all — the ~180 pre-feature sessions) still counts toward
  invocation totals, but contributes nothing to associated $ or output tokens.
- **Subagent-triggered invocations count** (no `trigger_type` filter) — they carry the parent
  session's `session_id`, so they associate with the parent's cost.
- **`skill_name` values with no `skills` row** (`run`, `dataviz`, `doctor`, `statusline`, leaked
  built-ins / uninstalled / renamed skills) still appear, with `skillId: null` — rendered without
  click-through. Installed names resolve to a single row by shadowing precedence
  (global > project > synced), the same rule `SKILLS_WITH_USAGE_SELECT` encodes.

### Tier 4 — needs the 2b capture layer

- Tool-schema **cut list** (tools ranked by token size — the proxy's best trick)
- System-prompt size
- Exact per-request composition (tools vs system vs history summing to billed `input_tokens`)

---

## First cut — Phase 2a

### Scope

Tier 1 + the Tier 3 association table. **Not** Tier 2 (dedup risk spent on "huh, neat" numbers),
**not** Tier 4 (needs 2b).

### The "Usage" view — five stacked sections

1. **Activity** — active days, sessions, prompts, and their day/time/project distributions
2. **Cost** — estimated API-equivalent cost, coverage caveats, and model/project/day splits
3. **Model & effort** — per-turn model and effort counts (PR4)
4. **Skills** — 24h/7d/30d activity, trigger mix, and the clearly labelled Tier-3 association table
5. **Your resident tax** — context-budget-v2: the measured turn-1 total, the itemized parts, and
   **one grey "system + tool schemas" bar** labelled _"run a capture to break this down"_ that 2b
   subdivides

### Build order

This table is the original **dependency**-ordered work breakdown; its `#` column is not the PR
number. The **Status** column maps each row to the canonical PR sequence at the top of this doc.

| #   | Work                                                                                                                                                                                                                                                                                                                                                                                                                      | Unlocks                                   | Status            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | ----------------- |
| 1   | `session_cost` + `session_model_cost` (one row per priced session / per-model), populated by the existing `scanTranscripts` walk — `extractCostState` on main transcripts only, `toModelCostRows` projection, one `transcript_parser_version` bump. `getCostStats` collapses `continued-in` lineages and drops zeroed rows at query time. Fixture-snapshot guards the JSON shape. **No `turn_usage`** — deferred past PR2 | Cost panel                                | ✅ PR2            |
| 2a  | `history.jsonl` ingest + `prompt_history`                                                                                                                                                                                                                                                                                                                                                                                 | Activity section                          | ✅ PR1            |
| 2b  | Reuse `skill_invocations` ⋈ `session_cost` (`getSkillStats`) + two `skill_invocations` indexes                                                                                                                                                                                                                                                                                                                            | Skills section + Tier-3 table             | ✅ PR3            |
| 3   | Attachment parsing (`skill_listing`, `hook_success`, `mcp_instructions_delta`) + fresh-session detection                                                                                                                                                                                                                                                                                                                  | Resident-tax panel                        | design-only (PR5) |
| 4   | `turn_usage` table (per-turn model/effort) + the proportional-attribution rider below                                                                                                                                                                                                                                                                                                                                     | Model & effort panel + honest per-skill $ | ✅ PR4            |
| 5   | The "Usage" view assembling all sections                                                                                                                                                                                                                                                                                                                                                                                  | ship                                      | in progress       |

Step 3 is the only genuinely new parsing and the most on-identity panel (it's the existing
context budget, ground-truthed and extended).

### `turn_usage` — shipped schema (PR4)

PR4 added this per-logical-turn table. `cost-state` remains the sole basis for every dollar and
per-model dollar figure; `turn_usage` supplies model/effort counts and allocation weights only.

```sql
CREATE TABLE IF NOT EXISTS turn_usage (
  id INTEGER PRIMARY KEY,
  logical_turn_key TEXT NOT NULL UNIQUE,   -- message id, then request id, then source uuid fallback
  source_uuid TEXT NOT NULL UNIQUE,        -- first physical record retained as provenance
  session_id TEXT NOT NULL REFERENCES sessions_meta(session_id) ON DELETE CASCADE,
  request_id TEXT,                         -- assistant line's requestId; the join seam to 2b
  message_id TEXT,
  turn_index INTEGER NOT NULL,             -- chronological logical-turn ordinal
  model TEXT NOT NULL,                     -- normalized (strip date suffix); '<synthetic>' rows skipped at ingest
  effort TEXT,                             -- xhigh | high | medium | low | NULL
  input_tokens INTEGER NOT NULL,
  cache_read_tokens INTEGER NOT NULL,
  cache_creation_tokens INTEGER NOT NULL,
  cache_creation_5m_tokens INTEGER NOT NULL,
  cache_creation_1h_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,          -- includes thinking_tokens; do not add separately
  thinking_tokens INTEGER NOT NULL DEFAULT 0,
  web_search_requests INTEGER NOT NULL DEFAULT 0,
  agent_id TEXT,                           -- subagent filename stem; NULL for main-session turns
  active_skill TEXT,
  invoked_at TEXT NOT NULL
);
CREATE INDEX idx_turn_usage_session_id ON turn_usage(session_id);
CREATE INDEX idx_turn_usage_active_skill ON turn_usage(active_skill);
CREATE INDEX idx_turn_usage_invoked_at ON turn_usage(invoked_at);
-- NEVER SUM cost from this table. Session $ comes from cost-state. This table is for
-- intra-session shape (growth curve, model/effort mix) and the 2b request_id join only.
```

Session $ / token rollups are a query-time `GROUP BY` (`getCostStats` in `src/main/db/queries.ts`)
over the `session_cost` / `session_model_cost` ingest that reads `cost-state` verbatim (rows
absent for the ~180 pre-feature sessions). Not stored denormalized.

### PR4 rider — proportional per-skill cost attribution (shipped)

PR4 replaced PR3's naive, overlapping association with this per-turn approximation. It splits each
session's real `cost-state` per-model total across turns by output-token weight, sums back to the
true total, and yields an honest "general work" bucket.

- **Weight:** for each model M in a session, split `cost-state.modelUsage[M].costUSD` across M's
  turns by `output_tokens` weight; attribute each turn to its active skill; sum per skill across
  models. **No price table, no multiplier guesses** — a new model only needs its `costUSD` present.
- **Subagent turns included:** walk `subagents/*.jsonl`, weight the same way. A subagent turn's
  active skill = the skill(s) invoked in that agent file (`skill_invocations.agent_id` join); none
  → "general work". This is what stops subagent-run skills (`visual-verify`, `impeccable`) from
  dumping their cost into the general bucket (measured: 19% of tracked spend fell there with a
  main-chain-only prototype).
- **Active-skill resolution:** per-turn `attributionSkill` when present (ground truth); else the
  last `Skill` tool_use / slash trigger, sticky until the next. **Documented ceiling:** over-credits
  a fire-and-return skill for the turns after it; degrades as skill density rises.
- **Lineage:** attribute at the turn's own session, then roll turns up to the priced terminal the
  same way PR3's `resolvePricedTerminal` does — so the per-skill split and the whole-session
  association agree on which terminal owns a lineage's cost.
- **Storage:** derived table `session_skill_cost (session_id, skill_name, est_cost_usd)` written
  during `scanTranscripts` (same pattern as `session_cost`); `skill_name = NULL` sentinel = general
  work. `turn_usage.active_skill TEXT` computed at ingest (same "compute once" pattern as
  `prompt_history.is_slash_command`). Parser-version bump on those semantics.
- **Presentation:** replaces PR3's naive Associated-cost column; adds a "General work (no skill
  active)" row; **drops** the overlap caption (columns now sum to the tracked total) → replaced by
  an "estimated share · method" note.
- **Scale guards (resolved in PR4):** indexes cover `session_id`, `active_skill`, and `invoked_at`.
  Transcript input is decoded as a 64 KiB UTF-8 line stream and large tool-result payloads are
  discarded after each record; no size threshold skips history. The opt-in regression benchmark
  covers just over 600 MiB total with one 150 MiB session and asserts cold ≤30 s, cached ≤1 s,
  post-scan RSS growth <128 MiB, and zero skipped logical turns.

### Cost ingest rules (restating the hazards as procedure) — **as shipped, PR2**

1. For each main transcript, read **only the last** `type:"cost-state"` line (`extractCostState`).
2. Store the `continued-in` link (`session_cost.continued_in_session_id`) at ingest;
   **`getCostStats` collapses lineages at query time** — every aggregate filters
   `is_zeroed = 0 AND continued_in_session_id IS NULL` (the priced-terminal predicate), so a
   non-terminal's total is never double-counted.
3. Store `totalCostUSD`, per-model `costUSD` + token counts, `hasUnknownModelCost` verbatim.
   `hasUnknownModelCost` surfaces as the §C6.2 caveat line; the hero numeral gets no hedge glyph.
4. Do **not** read `subagents/*.jsonl` for cost — already in the parent total.
   `parseSubagentInvocations` stays cost-free (locked in `docs/transcript-ingest.md`).
5. Sessions with no `cost-state`: no `session_cost` row. `getCostStats` reports them via
   `preTrackingSessionCount` (before `trackedSince`) / `unusableSessionCount` (after it) in the
   §C9 footnote — never a `$` figure.
6. All dollar copy: "estimated API-equivalent cost", with the `/cost`-style disclaimer.
7. Store **core fields only** (`totalCostUSD`, per-model `costUSD`, per-model token counts,
   `hasUnknownModelCost`). Peripheral fields may churn — read them ad hoc if ever needed, don't
   give them columns. (`session_model_cost` does keep the full 6-token column set even though no
   PR2 panel reads them — the parser already produces them and it avoids a reindex when a Tier-2
   token panel wants them.)
8. **One `transcript_parser_version` for the whole walk** — cost rides `scanTranscripts`, so a
   cost-state shape change bumps that single constant (PR2: `3 → 4`) and forces a history
   reindex. No separate `cost_parser_version`. A fixture-snapshot test (`FROZEN_COST_STATE` in
   `cost-parser.test.ts`) makes a silent rename fail in CI.

### Ceilings accepted in PR2

- **`byDay` buckets on `session_cost` ⋈ `sessions_meta.started_at`, local date** — a session that
  ran across local midnight lands its whole total on its start date (midnight smear). Acceptable:
  the by-day strip is the section's thinnest story anyway.
- **No terminal-missing-`cost-state` fallback.** A lineage terminal with no `cost-state` line is
  counted as unusable, not back-filled from a non-terminal in its chain. 0 real cases in the
  exploration data (`explore-usage.report.md` Q3).
- **A pre-`trackedSince` session that also has a zeroed / non-terminal cost row counts as
  pre-tracking**, not unusable — the date cut wins (`preTrackingSessionCount` is a pure
  `started_at < trackedSince`). ~0 real cases.

### Open questions for implementation

- **Fresh-session detection** for the resident-tax measurement: how to be sure `apiBlockIndex 0`
  is a cold start and not a resume/compaction. Candidate: first line has no `continued-in` in its
  lineage **and** `cost-state.startTime` (if present) ≈ first-line timestamp **and** turn-1
  `cache_read_input_tokens` ≈ 0.
- **`turn_usage` dedup key** — `source_uuid` (the line's `uuid`) vs `requestId`. `uuid` matches
  the `skill_invocations` pattern and is per-line; `requestId` can repeat across retried
  iterations. Leaning `uuid`.
- **Where the "Usage" view sits in nav** — peer of Skills / Plugins, or a sub-tab.
- **Scan cost** — per-turn extraction over 577 MB of transcripts. The existing mtime/size +
  `transcript_parser_version` cache covers freshness; closed sessions never re-scan. Needs a
  one-time backfill measurement.

---

## Deferred

| Item                                                                                | Why not in the first cut                                                                                                                                                                                                         | Revisit when                                                                                           |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| **Tier 2 panels** (token volume, cache efficiency, growth curve, tool distribution) | Each needs a careful anti-double-count dedup of per-turn `usage` and _still_ ships with a hedge badge — risk + permanent caveat copy spent on "huh, neat" numbers                                                                | Tier 1 is live and a specific Tier 2 number is actually wanted for a decision                          |
| **Tier 4 / the tool-schema cut list**                                               | Needs 2b — the capture layer. Sequenced, not cut                                                                                                                                                                                 | 2a proves the feature earns repeat opens                                                               |
| **True per-skill cost attribution**                                                 | Session cost isn't cleanly decomposable into co-occurring skills. PR3's association table is the honest ceiling until then; the **PR4 rider** (proportional per-turn split) is the designed approximation, gated on `turn_usage` | `turn_usage` lands (PR4)                                                                               |
| **Lifetime cost total**                                                             | Version gate (53/234 sessions) + the double-count hazards. "Tracked since Aug 2026" + excluded count instead                                                                                                                     | `cost-state` coverage becomes near-complete as old sessions age out                                    |
| **Rate-limit window %** (the actual `/usage` view)                                  | Server-side. Not in local files                                                                                                                                                                                                  | Never, unless CC starts writing plan-limit state locally                                               |
| **Bottom-up token pricing** (a price table + estimator)                             | Strictly worse than `cost-state`: less accurate, breaks every model release, and is where all the accounting bugs live                                                                                                           | A hard requirement for full historical dollar coverage emerges — treat as its own dedup-design project |
| **Session-centric view** (a "Sessions" list, drill into per-turn growth)            | Closest to what the proxy markdown _is_, but the narrowest audience. Heaviest surface                                                                                                                                            | Detail-page weaving proves users want to go deeper than the overview                                   |
| **Detail-page weaving** (`SkillDetail` / `PluginDetail` gain real numbers)          | Scatters the story across pages before the overview establishes it                                                                                                                                                               | The "Usage" view ships and the per-entity number is the top ask                                        |
| **Megatron runs / supervises a proxy**                                              | Auth-token MITM + owning the "broke my CLI" failure mode. Identity violation                                                                                                                                                     | Not expected — cut, not deferred                                                                       |
| **Parsing a capture tool's rendered markdown**                                      | Fragile coupling to a third party's format for no upside over the raw request body                                                                                                                                               | Not expected — cut, not deferred                                                                       |
| **Qualitative session analysis** (`usage-data/facets/*.json`, `report.html`)        | A different feature (journal / coach). Out of scope for a context-cost surface                                                                                                                                                   | A journal/coach feature is greenlit, with its own privacy pass                                         |
| `~/.claude.json` `projects[].lastCost`                                              | Observed `0`/empty even for real sessions; only the most recent per project                                                                                                                                                      | Never — transcripts are the source of truth                                                            |

---

## Relationship to existing surfaces

- **Context budget** (`src/renderer/src/lib/context-budget.ts`, `ContextBudgetDialog.tsx`) —
  currently sums `est_listing_tokens` (`chars / 3.0`, calibrated not exact) over enabled
  model-invocable global + plugin skills. The Tier-1 **Resident tax** panel is this, ground-truthed
  against the `skill_listing` attachment and extended to hooks + MCP instructions + (in 2b) tool
  schemas. It supersedes the dialog's scope; the dialog's "heaviest skills / disable this" flow is
  the template for the _first real lever_ this feature grows.
- **`docs/transcript-ingest.md`** — this feature adds a second consumer of the transcript walk.
  Its `isSidechain === false` + dedicated-subagent-file rules are necessary but **not sufficient**
  for the cost path (hazard 2). Any change to the walk must keep both consumers correct.
- **`docs/mvp-build-spec.md`** "Deferred, on purpose" — the "Cost analytics, MCP dashboard" row
  and the "Plugin component-inventory / token-cost analysis (Tier 2)" row both point here. Update
  those rows to reference this doc when Phase 2 is greenlit.
- **`CLAUDE.md`** Docs table — add a row for this doc ("Usage analytics / cost insights · Consult
  before `src/main/ingest/` usage extraction or the Usage view") when implementation starts.
