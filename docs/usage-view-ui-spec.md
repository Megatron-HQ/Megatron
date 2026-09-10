# Usage view — resolved UI spec (Phase 2a)

**Scope:** the page frame + AppRail entry, the **Activity** section (PR1, §5), the **Cost**
section (PR2, §C), and the **Skills** section (PR3, §S). Model & effort and Resident tax are still
**not** designed here — only the frame they inherit.

**Status:** Activity resolved in a grill session 2026-09-05 (feeds PR1). Cost resolved in a
follow-on grill 2026-09-07 (feeds PR2); that pass also revised two cross-cutting rules — section
entrance motion (§4.2) and the by-project primitive (§5.4 is superseded by §C4). Skills was
implemented 2026-09-09 (PR3) and its spec (§S) reconciled with the shipped code after `2f1b552`.
Design system base: `DESIGN.md` ("Inventory Ledger"). Departures are listed explicitly per
section (§8, §C10, §S7).

---

## 1. AppRail entry

- New `AppSection` value `'usage'`, third position after `plugins` in `AppRail.tsx`'s `SECTIONS`.
- **Icon:** `BarChart3` (lucide). Label + tooltip: **"Usage"**.
- **Active state:** ink-fill (`bg-muted text-foreground`), same as the other two — **not lime**. No
  change to the rail's rules or the One Stamp Rule scope.
- `resolveInitialSection` (`src/main/theme.ts`) hardened to enum-validate and fall back to
  `'skills'` on an unknown stored value. _(megatron-6b plumbing — noted, not part of this spec.)_

---

## 2. Page frame

### 2.1 Structure

`App.tsx`'s binary `section === 'skills' ? … : …` becomes a three-way branch. The `usage` branch
renders **`<AppRail/> + <UsageView/>` with no sidebar** — the first section without one. The
`skills` and `plugins` branches must render byte-identical to today (plan decision 7).

`<UsageView>` outer shell **mirrors `SkillInventory`'s exactly**:

```
flex flex-1 flex-col overflow-hidden
├── header:  h-10 shrink-0 border-b border-border px-4   (PINNED — does not scroll)
└── body:    flex-1 overflow-y-auto
        └── content column:  w-full max-w-[960px]  (left-aligned, NOT centered)
```

The macOS drag strip (`App.tsx`, `h-8 drag-region`) already sits above this row app-wide — no
conflict with the pinned header.

Scroll position **resets to top** on section switch (branch swap → remount). Acceptable for v1.

### 2.2 Pinned header contents

| Side  | Content                                                                                                                                                                                                                                    |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Left  | `[BarChart3 size-3.5] Usage` — 13px/600 ledger-ink. **No "Claude Code" prefix** (that prefix earns its place on Skills/Plugins because they inventory Claude Code's assets across sources; Usage is unambiguously the user's own history). |
| Right | **7d/30d segmented toggle** (§3), then a muted `Updated 2h ago` derived from `activity.generatedAt`. The "updating…" pulse keys off a refetch being in flight _after the first successful load_ (poll-until-`scanComplete`, see §6).       |

### 2.3 Section model

The page is a flat vertical scroll of stacked sections. Fixed order, top→bottom:

1. **Activity** (PR1)
2. Cost _(PR2)_
3. Model & effort _(PR4)_
4. Skills _(PR3)_
5. Resident tax _(PR5)_

Activity is first because it is the zero-caveat, always-populated section — every user has
`history.jsonl`; only ~22% have cost data.

**Anatomy of one section:**

```
── 960px-wide rule-line (border-border), py-8 above/below ──────────

Activity                          ← section header: 13px / 600 ledger-ink
Prompts, sessions, active days     ← optional 11px muted subtitle (Activity: DROPPED, stats speak)
                                     (gap-6 = 24px)
[ section content ]
```

- **Section header: 13px / 600 ledger-ink** + optional 11px muted subtitle. _(Revised up from an
  earlier 11px-uppercase proposal — a 5-section scroll needs real structure, and 13/600 is still
  under the 16px ceiling.)_
- **Per-chart label inside a section: 11px uppercase muted** (`label-column` token) — e.g.
  "By day", "By time of day", "By project". Two-level hierarchy: section 13/600 → chart 11/upper.
- No per-section actions, no collapse/expand, no in-header jump-nav (revisit jump-nav in the PR
  that adds section #4, not now).
- Rule-lines between sections are **960px wide** (match content), not full-bleed into the empty
  right gutter.

### 2.4 Vertical rhythm

| Gap                                         | Value                           |
| ------------------------------------------- | ------------------------------- |
| Between sections                            | `py-8` (32px) + 960px rule-line |
| Section header → content                    | `gap-6` (24px)                  |
| Within section, stat row → each chart block | `gap-6` (24px)                  |
| Chart label → chart                         | `gap-2` (8px)                   |
| Section horizontal padding                  | `px-6`                          |

---

## 3. 7d / 30d toggle

- **Placement:** right side of the pinned header, before "Updated".
- **Style:** segmented control **identical to `SettingsDialog`'s appearance switch** —
  `role="radiogroup"`, 1px `border-border` wrapper, active item `bg-muted text-foreground`
  (ink-fill, **not lime**), inactive `text-muted-foreground`. Two options, labels **"7 days" /
  "30 days"** (words, not "7d").
- **Default: 30 days.** (One-line change to open on 7.)
- **Scope: page-global**, governs the windowed sections — Activity now; Model & effort when it
  lands. Three carve-outs by design:
  - **Cost ignores the toggle** — it spans the whole cost-tracked window (§C, resolved in the PR2
    grill; `getCostStats` takes no window arg).
  - **Skills section brings its own inline control** — it needs _24h_ / 7d / 30d (a different
    option set per `usage-analytics.md`), so it owns that control rather than distorting the
    global one. Its `pricedSessionsWithoutSkill` caption count still spans all history, like Cost.
  - **Resident tax** is a single dated sample — no window, ignores the toggle.
- **Note for megatron-6b:** if Cost turns out to be "all tracked history since Aug 2026" rather
  than a 7/30 cut, Cost should simply not respond to the toggle and say so in its subtitle — do
  **not** add a third "All" option to the toggle for one section.

---

## 4. Chart vocabulary (cross-cutting — PR2–5 inherit this)

**Hand-rolled, no charting library.** The entire Activity section and most of what follows are bar
charts; a library (Recharts/visx/Chart.js) ships visual opinions (tooltip chrome, default axis
styling, entrance animations) that would cost as much to override as clean bars cost to build, and
adds bundle weight to an already-heavy Electron app. Reopen only if the deferred context-growth
_line_ chart ever ships — evaluate `d3-shape` alone or `uPlot` then, never a full framework.

Build a small reusable vocabulary in `src/renderer/src/components/usage/`: a `<BarRow>` primitive,
a `<HeatCell>` grid, shared axis/label helpers. ~100–150 lines total.

### 4.1 Ink tokens (new — additive, monochrome, no hue)

| token               | light              | dark               | use                                  |
| ------------------- | ------------------ | ------------------ | ------------------------------------ |
| `--usage-bar`       | `oklch(0.145 0 0)` | `oklch(0.985 0 0)` | default bar fill                     |
| `--usage-bar-quiet` | `oklch(0.70 0 0)`  | `oklch(0.45 0 0)`  | context / de-emphasized bars         |
| _(track)_           | `--surface-muted`  | `--surface-muted`  | unfilled rail — horizontal bars only |

- **Default: every bar full ink**, kept **thin with air between** (~6–8px bar, ≥4px gap). The
  polish is proportion and restraint, not color.
- **`--usage-bar-quiet` is opt-in per chart**, only where one value must be named and bar height
  alone doesn't carry it — emphasized bar stays full ink, the rest drop to quiet. Two-tone
  monochrome, **never color**.
- A tinted "data" color was considered and rejected — it would be the "second accent" the Don'ts
  list forbids; the ledger is explicitly near-monochrome.
- **Punchcard intensity scale** (§5.3): empty + 4 levels of `--usage-bar` at **15 / 40 / 65 / 90%**
  opacity, **quantile-bucketed** (not linear) so the two peaks don't wash everything else out.
  This is the one opacity sub-pattern in the system; PR2's cost-by-project may reuse it.

### 4.2 Motion & interaction (uses existing `motion/react` + `useGlideHighlight` — no new deps)

| Moment                                                              | Behavior                                                                                                                                                               | Timing                                         | Reduced-motion            |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------- |
| **Enter**                                                           | bars rise from baseline (`scaleY 0→1`), staggered                                                                                                                      | 320ms `easeOut`, 12ms/bar, whole strip ≤ 600ms | snap to final             |
| **Bar hover**                                                       | one **shared glide indicator** springs between bars (reuse `useGlideHighlight`: stiffness 500 / damping 40) — 1px ink outline on the bar + value label riding above it | spring                                         | indicator jumps, no glide |
| **Scrub** (hour strip + by-day strip only)                          | pointer anywhere over the plot snaps the glide to the nearest bar + a 1px `rule-line` vertical guide follows the cursor                                                | spring                                         | guide snaps               |
| **Sibling focus** (by-weekday marginal + by-project only — small N) | non-hovered bars fade to `--usage-bar-quiet` @ 55% while one is hovered                                                                                                | 150ms                                          | none                      |
| **7d ↔ 30d switch**                                                 | bars interpolate to new heights (spring); strip charts cross-fade the bar count; **stat numerals roll** to the new value                                               | ~450ms                                         | numerals snap, bars swap  |

- The 24-bar hour context and the by-day strip **skip sibling-focus** — too twitchy at that density.
- **Stat-numeral roll fires on window-switch only** — NOT on mount.
- The **7d↔30d switch is the signature moment** — the whole page visibly "retunes" in one
  coordinated spring.
- Every `motion` use guards `useReducedMotion()` explicitly (Motion-Earns-Its-Keep Rule).
- **Section entrance (revised in the PR2 grill, applies to all sections below the fold —
  Cost, Model & effort, Skills, Resident tax):** the "Enter" row above fires **on
  scroll-into-view** (`motion/react` `whileInView`, `viewport={{ once: true }}`), **not on
  mount**. Activity stays mount-triggered — it is always the first section and above the fold.
  Animating a below-fold section on mount wastes the entrance; by the time it is scrolled to it
  has already settled. Reduced motion → the section just appears.

---

## 5. Activity section

Single column, everything full-width, stacked in this order. No side-by-side (960px can't pair
any two without cramping).

### 5.1 Stat cells

Contract: `activeDays`, `sessions`, `prompts`, `slashCommands`.

```
  42              234             1,381
  ACTIVE DAYS     SESSIONS        PROMPTS

  + 273 bare slash-commands (/clear, /quit) — not counted as prompts
```

- **3 primary cells**, left-aligned, separated by a generous gap + optional 1px vertical
  `rule-line`. **No borders, no cards** (Ledger-Lies-Flat).
- **`slashCommands` is a footnote** at body size / ink-muted — context for "Prompts", not a peer
  metric. Honors the contract's "a lone stat".
- **New type token `--usage-stat`:** 30px · Geist **Mono** · `tabular-nums` · `-0.01em` ·
  line-height 1.1 · weight 500 · ledger-ink. Label below each = 11px uppercase muted
  (`label-column`, reused).
- **Not in PR1:** delta-vs-previous-period ("▲12 vs prior 30d") — needs new contract surface, not
  called for. No sparkline inside the Prompts cell — by-day gets its own treatment.

### 5.2 By day

Contract: `byDay: { date, count }[]`, zero-filled, ascending — 7 or 30 entries.

- **Bar strip**, full column width, directly under the stat cells.
- **30d:** 30 thin full-ink bars (~8px, small gaps). **7d:** 7 bars, width-capped ~32px,
  left-aligned.
- Plot ~72px tall, linear scale, tallest day = full height. No axis lines, no gridlines — one
  faint baseline rule only.
- **Weekend band:** subtle `--surface-muted` background column behind every Sat/Sun. Monochrome.
  Makes this user's 60%+-weekend rhythm visible instantly. **Use `byDay[].weekday`** (0 = Sunday,
  computed server-side) for this test — do **not** re-parse `byDay[].date`, that's a TZ footgun.
- **Today** = always the last bar, partial → rendered **outline-only**, tooltip "today, so far."
- **X labels:** 30d → first date, last date, ~2 midpoints (11px mono muted). 7d → weekday
  initials under each bar.
- **Scrub:** guide line + glide indicator + floating label "Sat Aug 30 · 47 prompts."
- Mount: bars rise staggered left→right.
- Rejected: GitHub-style calendar heatmap (needs an opacity scale, collapses to one awkward row at
  7d, duplicates the punchcard's weekday read).

### 5.3 By time of day — punchcard with marginal bars

**Replaces separate "busy hours" and "busy weekdays" charts.** Two bar charts show bimodal hours
_or_ weekend skew but never "Saturday afternoons + late weeknights" — this user's actual pattern
and the more interesting read.

```
        0     6      12     18   23
        ┌────────────────────────────┐  ← top edge: per-hour totals (thin --usage-bar bars)
   Mon  │ ░░              ▓▓▓        │ ▍
   Tue  │ ░               ▓▓         │ ▍
   Wed  │ ░░     ░       ▓▓▓▓  ░░    │ ▎▎
   Thu  │ ░░░           ▓▓▓▓▓ ░░░    │ ▎▎▎
   Fri  │ ░░░░         ▓▓▓▓▓▓ ░░░░   │ ▎▎▎▎
   Sat  │ ▓▓▓░        ██████▓ ▓▓▓░   │ ▊▊▊▊▊▊
   Sun  │ ▓▓▓░       ▓▓▓▓▓▓  ▓▓▓░    │ ▊▊▊▊▊
        └────────────────────────────┘
                                       ↑ right edge: per-weekday totals
```

- **7×24 grid.** Container bg = `--rule-line`, cells 1px gap (grid shows through), empty cells =
  paper. Cell ~24–28px at default width (~30px at min), 2px radius. Row labels **Mon–Sun**, column
  ticks at 0 / 6 / 12 / 18.
- **Intensity:** monochrome quantile buckets — empty + `--usage-bar` @ 15/40/65/90% (§4.1).
- **Marginal bars** derived by summing matrix rows/cols — top = hourly totals, right = weekday
  totals, both `--usage-bar`. Weekday skew (Sat 469 vs Mon 55) renders honestly as bar length; no
  distortion needed.
- **Hover:** cell gets 1px ink outline + faint row+column crosshair tint + floating label
  "Saturdays, 4–5 pm · 38 prompts."
- **Mount:** cells fade/scale in on a diagonal sweep (top-left → bottom-right); reduced-motion →
  appear.
- Right-edge weekday marginal bars get **sibling-focus** on hover; the top-edge hour marginal does
  not (24 bars, too twitchy).

**CONTRACT ASK:** add `byHourWeekday: number[][]` to `ActivityWindow` — **7 rows × 24 cols**, local
time, **row index 0 = Sunday** (matches existing `byWeekday`). Keep `byHour` / `byWeekday` as-is
(harmless; possible standalone fallback). The renderer derives the marginals by summing this
matrix.

### 5.4 By project

Contract: `byProject: { project, count }[]`, full list, descending. `project` is a raw cwd path
(matches `sessions_meta.cwd`).

- **Horizontal bar list.** Row: `getFolderBasename(project)` (13px body, truncate, ~38% width,
  full path on hover) · bar (fills middle, `--surface-muted` track + `--usage-bar` fill, linear
  scale vs. the max) · `count` (12px mono, right-aligned).
- Row height **~28px** — tighter than the 40px ledger rows; this is a chart, not the table.
- **Top 8 shown**, remainder collapsed into a final muted row "+ 12 more projects · 143 prompts" →
  expands with the 0.15s height ease the sidebar sublists use. ≤8 projects → show all.
- Long tail renders as honestly tiny slivers against the dominant project. No log scale — the skew
  _is_ the point.
- Hover: sibling-focus dim + row highlight. **Not clickable in PR1** (a "filter the whole page to
  one project" feature is real but out of scope).
- **Note for megatron-6b / later:** `usage-analytics.md` §2 eventually pairs activity-by-project
  with cost-by-project. For PR1 it lives in Activity; PR2 decides whether they merge.

> **Superseded by §C4 (PR2).** The PR2 grill found the horizontal-bar-with-track form gimmicky —
> the `--surface-muted` track reads as a progress bar (progress toward a goal), and a skewed
> distribution leaves a row of near-empty tracks carrying no information. `<ProjectBars>` is
> replaced by `<RankedList>` (§C4) — a ranked table with an ambient left-anchored row fill and no
> track. PR2 swaps this Activity call site, deletes `ProjectBars`, and re-runs `visual-verify` on
> the Activity section. The two sections do **not** merge (Cost ignores the window toggle); they
> share the primitive, not the block.

---

## 6. Empty & loading states

**Two distinct empty cases:**

1. **No `history.jsonl` at all** — centered `BarChart3` (muted, size-8) + "No activity yet" +
   one line: "Megatron reads your prompt history from `~/.claude/history.jsonl`. It'll show up
   here after your next Claude Code session and a rescan." **No CTA** (not actionable).
2. **`history.jsonl` exists but the selected window is empty** (a quiet week) — _not_ the empty
   state. Render the section normally: `0 / 0 / 0` stat cells, each chart shows its frame with a
   quiet centered "No prompts in the last 7 days." Switching to 30d brings it back.

**Loading:** `Skeleton` (the shared component) blocks matching final shape — 3 numeral blocks +
label lines, one wide rectangle for the by-day strip, a muted grid block for the punchcard, 6
short rows for by-project. Never a spinner.

**Query shape** (mirrors `skills:list` in `App.tsx`): `usage:overview` returns
`{ activity, scanComplete }`. `useQuery(['usage'], …, { refetchInterval: q =>
q.state.data?.scanComplete ? false : 750 })`, and `['usage']` joins the `onScanComplete`
invalidation list. **Loading gate = `isPending || !data.scanComplete` → Skeleton.** Once
`scanComplete` is true, a later in-flight refetch drives the header "updating…" pulse, not the
skeleton.

---

## 7. Responsive

Sizes visual-verify checks (read live from `src/main/index.ts`): **default 1200×720**,
**min 860×500**.

- Content column `w-full max-w-[960px]` — fluid below 960. At min width, usable content ≈ 764px
  (860 − 48 rail − 48 px-6).
- **Punchcard:** cells flex-grow equally, ~30px at min width — no horizontal scroll needed at 860.
- **By-day strip:** bars shrink to fit count; 30 bars ≈ 25px each at min.
- **Stat row:** stays 3-across, ≥250px/cell at min — 30px numerals fit easily.
- No layout is allowed to only work at default size.

---

## 8. DESIGN.md departures (explicit)

| #   | Departure                                                                                                                         | Justification                                                                                                                                                                                                                                                              |
| --- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Content capped at `max-w-[960px]`** (left-aligned) — `DESIGN.md` says max-width is `none` everywhere except 72ch markdown prose | Usage is a _report you read_, not a _table you scan_ — same rationale as the prose cap. Wall-to-wall charts on a 1600px window is the "dashboard performing busyness" the doc rejects.                                                                                     |
| 2   | **`--usage-stat` type token at 30px** — above the 16px/600 No-Hero-Type ceiling                                                   | Scoped exclusively to the 3–4 primary stat numerals in the Usage view. Mono keeps it inside the "Geist Mono for data/token-counts" principle — only _size_ departs. A 5-section retrospective is a different surface class from the dense list/detail UI the rule governs. |
| 3   | **Section headers at 13px/600 ledger-ink** where existing surfaces would use a quieter divider                                    | A 5-section vertical scroll needs top-of-section structure. Still under 16px.                                                                                                                                                                                              |
| 4   | **Two new monochrome ink tokens** (`--usage-bar`, `--usage-bar-quiet`) + a **quantile opacity scale** for the punchcard           | `DESIGN.md` gives lime=reserved and flags=status-only with no neutral data ink. Both additions stay inside the "near-monochrome" discipline — no hue, no second accent.                                                                                                    |
| 5   | **Charts animate on enter / scrub / window-switch** more than most surfaces                                                       | Covered by the existing Motion-Earns-Its-Keep Rule ("not fixed to today's call sites, can grow into new surfaces as they earn it"). All guarded by `useReducedMotion()`.                                                                                                   |

Not departures: no sidebar on Usage (Plugins already runs without its own in the DESIGN.md text),
ink-fill rail active state (unchanged), Ledger-Lies-Flat (no cards, no rest shadows — floating
tooltips may cast one), every-signal-paired-with-icon (charts carry labels/axes, not color-alone
status).

---

## 9. Summary of asks for megatron-6b

1. **Contract:** `byHourWeekday: number[][]` (7×24, local, row 0 = Sunday) on `ActivityWindow` —
   _confirmed in the plan; `getActivityStats` computes it in the same reduce pass and derives
   `byHour`/`byWeekday` from it._ `byDay[]` entries also carry `weekday: number` (0 = Sunday,
   server-computed) — the renderer uses that for the weekend band, never re-parsing `date`.
2. `AppSection` gets `'usage'`; `AppRail` `SECTIONS` gets the `BarChart3` entry, third.
3. `App.tsx` binary branch → three-way; `usage` = rail + `<UsageView/>`, no sidebar.
4. `resolveInitialSection` enum-hardening.
5. `usage:overview` returns **`{ activity, scanComplete }`**; `activity` carries both `last7d` and
   `last30d` (renderer toggles client-side) plus `generatedAt`. Poll-until-`scanComplete` at 750ms,
   `['usage']` in the `onScanComplete` invalidation list.
6. New renderer files: `src/renderer/src/views/UsageView.tsx` + `src/renderer/src/components/usage/`
   (chart vocabulary). Two new CSS tokens + `--usage-stat` type step in the renderer's theme.

---

# C. Cost section (PR2)

**Scope:** the second section in the Usage scroll — the tracked-window headline, the per-model
spend breakdown, per-project ranking, and per-day shape. Per-session `$` cards are **deferred**
(a session-centric view is out of scope, per `usage-analytics.md`).

**Status:** resolved in a grill session, 2026-09-07. Feeds the PR2 plan. Data/ingest contract is
locked in the parallel data grill (`usage-analytics.md`, memory `usage_pr2_cost_design.md`) — this
section designs the renderer to fit it, and does not reopen it.

**Inherited data contract** (`usage:overview` gains a `cost` field):

```ts
cost: CostStats | null // null iff pricedSessionCount === 0
interface CostStats {
  trackedSince: string // ISO — MIN(started_at) over priced, lineage-terminal sessions
  totalCostUsd: number
  pricedSessionCount: number // "Covers N sessions since {date}"
  preTrackingSessionCount: number // sessions with started_at < trackedSince — pure date cut
  unusableSessionCount: number // started_at >= trackedSince but no usable cost row (zeroed + crashes)
  hasUnknownModelCost: boolean
  byModel: { model: string; costUsd: number }[] // desc; normalized keys, localeCompare tie-break
  byProject: { project: string; costUsd: number }[] // desc; project = raw cwd path
  byDay: { date: string; costUsd: number; weekday: number }[] // zero-filled trackedSince→today
}
```

(Data grill delivered both split fields — the earlier single `excludedSessionCount` is gone. An
edge: a pre-`trackedSince` session that also has a zeroed row counts in `preTrackingSessionCount`,
date wins; ~0 real cases.)

Cost **ignores the global 7d/30d toggle** — it shows the entire cost-tracked window. That window
is self-bounding: `cost-state` lives in transcripts, which Claude Code prunes at
`cleanupPeriodDays` (default 30), so once we are 30+ days past the Aug-2026 feature epoch
`trackedSince` becomes a rolling `now − cleanupPeriodDays`. Normally ≤ ~30 days; longer only for a
user who raised retention.

---

## C1. Section anatomy & order

Three content blocks — one fewer than the other sections, because the headline and the per-model
breakdown are **one composed object** (§C2), not two.

```
── 960px rule-line, py-8 ─────────────────────────────────────────

Cost                                     ← section header: 13px / 600 ledger-ink. No subtitle.
                                           (gap-6)
┌─ headline block ─────────────────────┐
│  $181                                 │  ← --usage-stat, 30px Geist Mono
│  ESTIMATED API-EQUIVALENT COST        │  ← 11px uppercase muted (label-column), below the numeral
│  ██████████████████ ██████ ▏          │  ← spend bar: 8px, 3 hued segments (§C2, §C3)
│  ● Sonnet 5  $145.69 · 81%   …        │  ← legend, flex-wrap
│  ⚠ …couldn't price…  (conditional)    │  ← hasUnknownModelCost caveat (§C6)
│  What this would cost at …            │  ← disclaimer, 11px muted, max-w-[520px]
│  Covers 62 sessions since …           │  ← footnote, 11px muted
└──────────────────────────────────────┘
                                           (gap-6)
BY PROJECT                               ← chart label: 11px uppercase muted
[ RankedList ]                             (§C4)
                                           (gap-6)
BY DAY
[ DayStrip ]                               (§C5)
```

**Order rationale — departs from Activity's order** (Activity is stats → _by day_ → by time → by
project). Cost puts by-day **last**: its temporal story is thin (a short burst, then a rolling
mostly-zero tail), while its _compositional_ story — where the money goes, by model and project —
is the section's whole point (`usage-analytics.md` §2 names this material _"Where it goes"_).
by-day anchors the bottom of the section the way by-project anchors Activity.

Vertical rhythm, empty/loading gate, the 960px rule-line, and `px-6` are all inherited from §2.3–2.4
and §6 unchanged.

---

## C2. The headline block — hero `$` + spend bar (the merged "by model")

The tracked-window total and the per-model breakdown render as **one object**: a hero numeral, a
single segmented part-to-whole bar directly under it, and a legend. This is the GitHub
repo-language-bar pattern.

**Rejected:** (a) a 3-row colored bar list — quiet, and makes by-model and by-project read as the
same chart twice; (b) a donut/ring with the total in the hole — `dataviz` flags pie/donut for
anything but near-equal values at ≤6 segments (the current Haiku arc is 2.2°, an invisible
hairline), and a ring is the most "dashboard performing busyness" object the app could add, which
`DESIGN.md`'s north star explicitly rejects; (c) by-model as its own separate block — the section
does not need four blocks and the merge gives it a single anchor.

### C2.1 Hero numeral

- **`--usage-stat`** (30px Geist Mono, `tabular-nums`, ledger-ink) — the same token Activity's stat
  cells use. This is exactly the "3–4 primary stat numerals in the Usage view" departure #2 scoped
  it for.
- **Whole dollars — `$181`, never `$180.77`.** The estimate is known to run ~16% high vs a real
  invoice (`usage-analytics.md`); cents are false precision on the hero figure. Cents _do_ appear
  in the legend and in `RankedList`, where magnitudes are compared.
- If `totalCostUsd` rounds to `$0` but `CostStats` exists, show **`<$1`**, not `$0` (reads as
  broken).
- Label `ESTIMATED API-EQUIVALENT COST` sits **below** the numeral (11px uppercase muted,
  `label-column`) — StatCells convention.
- New `formatUsd(n, { cents: boolean })` in `chart-utils.ts` alongside `formatCount`.

### C2.2 Spend bar

- **8px tall**, full content width, `rounded-[1px]` outer corners. **No track** — a part-to-whole
  bar fills 100% by definition; the whole bar is data. (This is what makes it legitimate where the
  `RankedList` track was not — §C4.)
- One segment per `byModel` entry, width ∝ `costUsd / totalCostUsd`, in payload order (desc).
- **2px paper gaps between segments** (`--background`, not a border — `dataviz` mark spec).
  Segments are square-cut internally; only the bar's two ends are rounded.
- **3px minimum width** for any non-zero segment, so a real-but-tiny value (Haiku, $1.14) reads as
  present, not missing. Mirrors `Punchcard`'s non-zero floor.
- Segment fill = the model's data-series hue (§C3). Unknown/unmapped model → `--usage-bar-quiet`.
- `hasUnknownModelCost`: **no extra segment** — an unpriced model has no `costUsd`, so it is absent
  from `byModel`; the flag only means the total is an undercount. Surfaced as a caveat line (§C6).

### C2.3 Legend

- `flex-wrap` row under the bar, `gap-x-6 gap-y-1`. One entry per segment, payload order.
- Entry: `●` (the model's data-series hue) + `formatModelName(model)` (13px body) + `formatUsd(_, {cents:true})` + `·` + whole-number `%` (`<1%` below one). Percentages are **not** force-balanced
  to 100 (largest-remainder later only if it ever bothers anyone).
- The dot carries the only color; **model name, `$`, and `%` stay in text ink/muted** (`dataviz`:
  text wears text tokens, never the series color). Identity is never color-alone — the label is
  right there.
- Kept **inline** (not a stacked mini-table) because it is a legend bound to the bar directly
  above it, not a standalone data block.

### C2.4 `formatModelName()` (new, in `chart-utils.ts` — PR4 reuses it)

`claude-sonnet-5` → `Sonnet 5`, `claude-opus-5` → `Opus 5`, `claude-haiku-4-5` → `Haiku 4.5`.
Regex-extract the family (`/^claude-([a-z]+)-/`), title-case it, append the version tail as-is. An
unrecognized key → the **raw key verbatim**, never hidden.

---

## C3. Data-series color — a new functional color layer

`DESIGN.md` today has two functional color layers on top of the monochrome ledger: the lime
**stamp** ("the one active thing") and the **status flags** (lint / disabled / budget). This
section adds a **third: data-series color** — meaning _series identity_, nothing else. It never
signals "active" and never signals "status"; the flags already set the precedent that a separate
purely-functional palette can coexist with the stamp without borrowing its job.

**Scope — deliberately narrow:** used **only where a chart splits by model**. That is Cost's spend
bar now, and PR4's Model & effort section later. **Not** by project (unbounded categories —
`dataviz` caps categorical color at ~7 and the story there is _emphasis_, not identity), **not**
by day (a time axis), **not** Activity's charts (none split by a bounded identity dimension). One
colored object per section, maximum.

### C3.1 Palette

Fixed assignment by **model family**, never by rank — a filter that changes which models appear
must not repaint the survivors (`dataviz` non-negotiable). Tokens are named by **slot**, not by
model ID, so "Sonnet 6" inherits slot 1 with no token change.

| Slot               | Family              | Light                                                    | Dark      |
| ------------------ | ------------------- | -------------------------------------------------------- | --------- |
| `--usage-series-1` | sonnet              | `#2a78d6`                                                | `#3987e5` |
| `--usage-series-2` | opus                | `#eb6834`                                                | `#d95926` |
| `--usage-series-3` | haiku               | `#1baf7a`                                                | `#199e70` |
| _(fallback)_       | any unmapped family | `--usage-bar-quiet` (neutral — the "Other" fold, no hue) | —         |

These are `dataviz`'s reference categorical slots 1–3. **PR2 re-ran
`dataviz/scripts/validate_palette.js` against Megatron's exact computed surfaces — `oklch(0.99 0 0)`
→ `#fcfcfc` (light) and `oklch(0.145 0 0)` → `#0a0a0a` (dark)** — and every check passes in both
themes:

| Check                                 | Light (`#fcfcfc`)                                    | Dark (`#0a0a0a`)                                     |
| ------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------- |
| Lightness band                        | PASS (all 3 in L 0.43–0.77)                          | PASS (all 3 in L 0.48–0.67)                          |
| Chroma floor (≥ 0.10)                 | PASS                                                 | PASS                                                 |
| CVD separation (adjacent, ≥ 8 target) | PASS — worst `#1baf7a`↔`#eb6834` ΔE **9.2** (deutan) | PASS — worst `#199e70`↔`#d95926` ΔE **9.4** (deutan) |
| Normal-vision floor (≥ 15)            | PASS — worst ΔE **27.6**                             | PASS — worst ΔE **26.5**                             |
| Contrast vs surface (≥ 3:1)           | **WARN** — `#1baf7a` at 2.74:1                       | PASS                                                 |

The one light-mode WARN (green on paper) is cleared by the **relief rule**: every use is
direct-labeled — the legend dot always has its model name beside it (§C2.3), and the spend-bar
segments are named in that same legend. Identical within rounding to the skill's default-surface
run, since `#fcfcfc`/`#0a0a0a` are within ~1% of `#fcfcfb`/`#1a1a19`.

- `chart-utils.ts` gets `modelSeriesVar(model: string): string` → the CSS var name for the family,
  or `--usage-bar-quiet` for an unmapped one, and `MODEL_SERIES` mapping `family → slot`.
- Tokens live in `main.css` **following the existing `--usage-bar` pattern exactly** — light values
  in `:root`, dark values in `.dark` (Megatron toggles a `.dark` class from `App.tsx` via
  `@custom-variant dark`; it does **not** use `@media (prefers-color-scheme)` or a `[data-theme]`
  attribute), plus the `@theme inline` `--color-usage-series-*` aliases so Tailwind utilities
  resolve. Ignore the `@media` / `[data-theme]` scoping in `dataviz`'s `palette.md` — that is the
  skill's own reference convention, not this repo's.
- Lime (`#e4f222`) is **excluded** from the data palette — it is the stamp, and a near-yellow
  would fail CVD against slot 2.

### C3.2 DESIGN.md amendment (apply during PR2 implementation — see §C11)

The layer is not "live" until `DESIGN.md` records it. §C11 carries the full proposed edit; it
lands with the PR2 code, the same way PR1's `--usage-*` tokens landed with PR1 — not in the grill
session.

---

## C4. by project — the `<RankedList>` primitive (replaces `<ProjectBars>`)

A ranked table with an **ambient left-anchored row fill and no track**. Replaces `<ProjectBars>`
everywhere in the Usage view — Cost's by-project **and** Activity's §5.4 (see the superseding note
there).

**Why not `<ProjectBars>`:** the `--surface-muted` track reads as a progress bar (progress toward
a goal / 100%), which a project split is not; on a skewed distribution (Megatron is 93% of tracked
spend) you get one full bar and a row of near-empty tracks carrying no information; and it is three
columns to scan (label → bar → number).

```
BY PROJECT
Megatron                                    $168.20   93%      ← ambient ink fill, ~93% of row width
sai                                           $6.29    3%      ← ~3% fill, barely there
JerseySTEM                                    $5.01    3%
agent-proxy                                   $0.85   <1%
claude-code-setup                             $0.42   <1%
```

- **Two columns.** `getFolderBasename(project)` (13px body, flex, truncate, **full path on hover**
  via `Tooltip`) · a fixed ~110px right column: `formatUsd(_, {cents:true})` + whole-number `%`,
  right-aligned, 12px Geist Mono `tabular-nums`, muted. The `%` does the share work the bar did —
  precisely, without the progress-bar reading.
- **Ambient fill:** ink at **~7% opacity light / ~12% dark**, from the row's left edge, behind the
  text, `width: {pct}%`. No track, no rounded pill, no border — it is a _tinted row_, not a bar. A
  page of them must not stripe. It renders at final width (**no width-grow animation**).
- Row height **~28px** (chart density, not the 40px ledger row). Hairline `border-border` between
  rows.
- **Top 8** shown, remainder folded into a final button-row `+ N more projects · $X.XX` that
  expands with the 0.15s height ease the sidebar sublists use. ≤8 → show all. (Rarely triggers for
  Cost; kept for parity with Activity, which needs it.)
- Sort: descending by value (payload order).
- **2px min fill width** for any non-zero value — `$0.42` is a visible sliver, not absent.
- Monochrome. Model color never bleeds here.
- Enter: **quiet fade** (200ms), optional 20ms/row stagger — explicitly _not_ a grow.
- Row hover: ambient fill deepens one notch (120ms) + the full-path tooltip. **No glide box** — it
  is a chart, not the main table. No sibling-focus dim (the fill widths already carry the skew).

**When this replaces Activity's §5.4:** the value/format is prompt _count_ not `$`, the `%` is
share of window prompts, everything else identical. PR2 swaps the call site, deletes
`ProjectBars.tsx`, and re-runs `visual-verify` on Activity.

---

## C5. by day — `<DayStrip>`, generalized

Reuse `<DayStrip>` (§5.2), generalized from `days: 7 | 30` to `days: number`.

- Thin monochrome `--usage-bar` bars, one per `byDay` entry, single faint baseline rule. **Zero
  days render as baseline only** — a mostly-empty strip with one burst is the honest picture
  ("almost all of it landed in three days").
- Keep the **weekend `--surface-muted` band** (`byDay[].weekday`, never re-parsed from `date`),
  the **outline-only "today" bar**, and the **scrub** interaction.
- Value in the scrub / hover label is `formatUsd(_, {cents:true})`: `Sat Sep 6 · $23.15`; today:
  `Sep 7 · $12.40 · today, so far`.
- X-labels: first date / last date / ~2 midpoints (30d-mode styling), 11px mono muted.
- Enter: staggered bar-rise, left→right (inherited).
- **Ceiling:** past **~45 bars** (a user who raised `cleanupPeriodDays`) the renderer buckets
  `byDay` to ISO weeks — bars become weeks, the weekend band drops, labels become week-of. The
  `byDay` payload stays daily regardless. Deferred until a real >45-day window exists; a
  `ponytail:` comment in `DayStrip` marks the ceiling and this upgrade path.
- Monochrome. Color stays in the spend bar.

---

## C6. Empty & degenerate states

### C6.1 `cost === null` — no priced session (`pricedSessionCount === 0`)

An **inline section empty state** — _not_ Activity's centred-`BarChart3` treatment, because Cost
is never the whole page (Activity above it is populated) and `DESIGN.md` says an absent-data
section stays inline, near its slot, not a full-page state.

```
Cost
─────────────────────────────────────────────────
[💲 muted size-4]  No cost data yet. Claude Code started recording per-session cost in
                   August 2026 — it'll show here after your next session and a rescan.
```

- Header **"Cost" stays** — a missing section reads as a bug.
- Body: one 13px `text-muted-foreground` line, left-aligned, `~py-4`, with an inline
  `CircleDollarSign` (lucide, muted, `size-4`).
- No numeral, no bar, **no CTA** — not actionable, same rationale as Activity's no-history state.

### C6.2 `hasUnknownModelCost === true`

A single caveat line between the legend and the disclaimer, rendered only when true:

> ⚠ Some usage ran on a model Claude Code couldn't price — the total above is a low estimate.

- `TriangleAlert` (lucide) in **`flag-amber`** — this is a genuine data-quality status, so
  flag-color + icon is correct per the Flags-Aren't-The-Stamp Rule; **not** the data palette.
- Only the icon is colored; text is 11px muted (mirrors `LintStatusBadge`).
- The hero numeral gets **no** hedge glyph (`~`, `≥`) — the figure is already "estimated"; a second
  qualifier on the numeral is noise. The caveat line carries it.

### C6.3 loading

Inherited from §6 — `Skeleton` blocks matching the final shape (numeral block + label, a wide
rectangle for the spend bar, ~5 short `RankedList` rows, a wide rectangle for `DayStrip`). Loading
gate is the shared `isPending || !data.scanComplete`. Never a spinner.

---

## C7. Motion

Section entrance fires **on scroll-into-view** (`whileInView`, `viewport={{ once: true }}`) — the
cross-cutting rule this grill added to §4.2. Within the section:

| Moment                     | Behavior                                                                                         | Timing                        | Reduced-motion        |
| -------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------- | --------------------- |
| **Spend bar enter**        | 3 segments grow `scaleX 0→1` from their left edge, in sequence                                   | 320ms `easeOut`, 80ms stagger | appear at final width |
| **Legend / segment hover** | hovered model's segment holds full hue; the other two drop to 40% opacity. Legend text unchanged | 150ms                         | none                  |
| **`RankedList` enter**     | whole list fades in; fills are at final width (no grow)                                          | 200ms, opt. 20ms/row          | appear                |
| **`RankedList` row hover** | ambient fill deepens one notch + full-path tooltip                                               | 120ms                         | tooltip only          |
| **by-day**                 | inherits `DayStrip` — staggered bar-rise, scrub                                                  | (§4.2)                        | (§4.2)                |

- **No "signature retune" moment** — Cost ignores the 7d/30d toggle, nothing re-tunes.
- **No glide indicator** anywhere in Cost (3 segments / a short list — not worth the spring).
- Every `motion` use guards `useReducedMotion()` (Motion-Earns-Its-Keep Rule).

---

## C8. Responsive (860px min → ≈764px usable content)

Fluid; nothing has a hard minimum.

- **Hero numeral + label** — 30px, trivially fits.
- **Spend bar** — full content width, thins with the column; ~8px of it is fixed (3px-min
  segments + 2px gaps), rest proportional — fine to ~300px.
- **Legend** — `flex-wrap`; the 3 entries sit on one line at default width, wrap to two near min.
- **`RankedList`** — basename flexes and truncates (full path on hover); the `$ + %` column is a
  fixed ~110px right rail.
- **by-day** — ~18–30 daily bars thin to fit (§7: "30 bars ≈ 25px at min"); weekly bucket past 45.
- **Disclaimer / footnote** — `max-w-[520px]` so they don't run the full 960px on a wide window
  (readability, same rationale as departure #1). Fits inside 764px at min.

No horizontal scroll; no layout that only works at default size (§7 rule).

---

## C9. Copy (every string)

**Header:** `Cost` — no subtitle.

**Headline label:** `ESTIMATED API-EQUIVALENT COST`

**Numeral:** `$181` · `<$1` if it rounds to zero.

**Disclaimer** (11px muted, `max-w-[520px]`):

> What this would cost at pay-as-you-go API rates — not a charge. Most Claude Code usage runs on a
> subscription billed separately, and these estimates may not match your actual bill.

**Footnote** (11px muted) — one composed sentence, clauses appear only when their count is `> 0`:

1. Always: `Covers {pricedSessionCount} sessions since {date}.`
2. If `preTrackingSessionCount > 0`: ` {preTrackingSessionCount} earlier sessions predate cost
tracking` + `" (added August 2026)"` **only when `trackedSince` is within ~10 days of
   2026-08-21** (feature-epoch-bound — once retention has pruned the old transcripts this count is
   normally 0 and the clause drops itself).
3. If `unusableSessionCount > 0`: `{", and " if clause 2 fired else " "}{unusableSessionCount}{"
more" if clause 2 fired} have no usable cost data`.
4. If clause 2 or 3 fired: ` — not included above.`

Rendered examples:

| Payload                                               | Footnote                                                                                                                                                            |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| priced 62, preTracking 180, unusable 12, epoch-bound  | `Covers 62 sessions since Aug 21, 2026. 180 earlier sessions predate cost tracking (added August 2026), and 12 more have no usable cost data — not included above.` |
| priced 40, preTracking 0, unusable 3, retention-bound | `Covers 40 sessions since Aug 8, 2026. 3 have no usable cost data — not included above.`                                                                            |
| priced 40, preTracking 0, unusable 0                  | `Covers 40 sessions since Aug 8, 2026.`                                                                                                                             |

**Legend row:** `● Sonnet 5   $145.69 · 81%` — `·` separator, cents on `$`, whole `%`, `<1%` below
one.

**`hasUnknownModelCost` caveat:** `Some usage ran on a model Claude Code couldn't price — the
total above is a low estimate.`

**Empty state (`cost === null`):** `No cost data yet. Claude Code started recording per-session
cost in August 2026 — it'll show here after your next session and a rescan.`

**by-day scrub:** `Sat Sep 6 · $23.15` · today `Sep 7 · $12.40 · today, so far`

**`RankedList` row:** `Megatron` … `$168.20   93%` (`<1%` for the tail); disclosure row
`+ 12 more projects · $3.10`.

**Date format:** `toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })`
→ `Aug 21, 2026`.

Locked, non-negotiable (from `usage-analytics.md`): "estimated API-equivalent cost" / "what this
would cost at pay-as-you-go API rates"; **never** "you spent" / "you were charged"; mirror
`/cost`'s "may not match your bill"; a visible excluded-session count; no `$` figure for untracked
sessions.

---

## C10. DESIGN.md departures (this section)

Inherits every §8 departure (960px cap, `--usage-stat`, 13px/600 headers, the `--usage-*` tokens +
quantile scale, charts animate). New with PR2:

| #   | Departure                                                                                                                       | Justification                                                                                                                                                                                                                                          |
| --- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C-1 | **A third functional color layer** (`--usage-series-1/2/3`) beyond the lime stamp and the status flags                          | Bounded (≤4), identity-typed, scoped to _by-model_ charts only, direct-labeled, CVD-validated. It never signals "active" or "status" — the flags already establish that a separate functional palette coexists with the stamp. Full amendment in §C11. |
| C-2 | **A segmented multi-color bar** (the spend bar) where the ledger has only single-fill bars                                      | It is one object, one region — `colorize`'s "the strongest color owns a deliberate region, not scattered accents". Part-to-whole is `dataviz`-canonical as a stacked bar.                                                                              |
| C-3 | **An ambient row-fill tint** in `RankedList` (ink at 7–12%) where the ledger uses rule-lines and explicit borders for structure | It is texture, not a mark — a peripheral magnitude cue with no chart chrome, quieter than the bar-with-track it replaces. Removes a gimmick, doesn't add one.                                                                                          |
| C-4 | **Section entrance on scroll-into-view** (`whileInView`)                                                                        | Extends §8 departure 5 (charts animate) to a 5-section scroll; a below-fold on-mount entrance is simply wasted. Guarded by `useReducedMotion()`.                                                                                                       |

Not departures: monochrome by-project and by-day (color stays in one region); the `flag-amber`
caveat icon (Flags rule, not the data layer); no cards, no rest shadows; hero numeral is text ink,
not a series color.

---

## C11. Proposed DESIGN.md amendment (lands with PR2 code)

**Frontmatter `colors:`** — add (light values; dark live in `main.css` per the existing
`--usage-*` pattern):

```yaml
usage-series-1: '#2a78d6' # data-series slot 1 — model identity (Sonnet family)
usage-series-2: '#eb6834' # data-series slot 2 — Opus family
usage-series-3: '#1baf7a' # data-series slot 3 — Haiku family
```

**Colors §, opening line** — `exactly two functional color layers on top` →
`exactly three functional color layers on top: one accent for "this is the active line," four
status flags, and a data-series palette for series identity in the Usage view's charts`.

**Colors §, new subsection after "Status flags":**

> ### Data-series (functional, not decorative)
>
> Three categorical hues — `--usage-series-1/2/3` (`dataviz` reference slots 1–3, CVD-validated in
> both themes) — carrying **series identity** in the Usage view only, and only where a chart splits
> by a bounded identity dimension (today: cost & activity **by model**; ≤4 series, ever). Assigned
> by entity in a fixed order, never by rank. Always direct-labeled — the hue rides a legend dot or
> a mark that sits beside its own text label, never color-alone. A fifth+ model folds to
> `--usage-bar-quiet` ("Other"), never a generated hue. Scoped hard: not by project, not by day,
> not the Skills or Plugins surfaces. Owned by `docs/usage-view-ui-spec.md` §C3.

**Named Rules §, add:**

> **The Data-Series-Stays-In-Its-Lane Rule.** The `--usage-series-*` palette means chart series
> identity and nothing else — never "active" (that's the stamp), never "status" (that's the
> flags), never a source-tier or a UI accent. It appears only inside `components/usage/` charts
> that split by model.

**Do's and Don'ts** — amend the existing don't:

> - **Don't** introduce a second accent color or a gradient — the ledger has exactly one stamp.
>   _(The `--usage-series-*` data palette is not an accent: it is scoped to Usage-view charts,
>   carries identity not emphasis, and is always direct-labeled — see the
>   Data-Series-Stays-In-Its-Lane Rule.)_

**`Overview §`** — the Usage-departures sentence gains `a scoped data-series color palette for
by-model charts` to its parenthetical list.

---

## C12. Asks for the implementer / data grill

1. ✅ **`CostStats.pricedSessionCount`** — accepted by the data grill (2026-09-07). Drives
   "Covers N sessions since {date}".
2. ✅ **`excludedSessionCount` split into `preTrackingSessionCount` + `unusableSessionCount`** —
   accepted. The §C9 footnote composes from the two.
3. `byModel` keys arrive **normalized** (date suffix stripped, per `cost-parser.normalizeModelKey`)
   — `formatModelName` / `modelSeriesVar` assume that.
4. `byProject[].project` is the **raw cwd path** — `RankedList` runs it through
   `getFolderBasename` and shows the full path on hover, exactly like Activity's §5.4.
5. Renderer work: `UsageView.tsx` gains the Cost section; new `components/usage/SpendBar.tsx`,
   `RankedList.tsx` (replacing `ProjectBars.tsx`); `chart-utils.ts` gains `formatUsd`,
   `formatModelName`, `modelSeriesVar`, `MODEL_SERIES`; `DayStrip` generalizes `days` to `number`;
   `main.css` gains `--usage-series-*` (+ `@theme` aliases); `DESIGN.md` gets the §C11 amendment.
   Re-run `validate_palette.js` against Megatron's computed surfaces and record the result.
6. `visual-verify` scenarios: add a Cost section with data, `cost === null`, and
   `hasUnknownModelCost` — and re-run the **Activity** scenarios (the `ProjectBars` → `RankedList`
   swap touches PR1).

---

# S. Skills section (PR3)

**Scope:** the section in the Usage scroll rendered directly after Cost (slot 3 as built; §2.3) —
a 24h/7d/30d activity readout (stat cells + invocation trend + two `RankedList`s) and a "Session
association" table. **Association, not attribution** (`usage-analytics.md` Tier 3): the table
shows which skills tend to run inside expensive sessions; it must never read as "this skill cost
$X". PR3 is a read-only projection over the existing `skill_invocations`, `session_cost`, and
`session_model_cost` tables — no scanner, schema, permission, or parser-version surface.

**Status:** authored at implementation time, then reconciled after `2f1b552` — which built the
windowing (§3's Skills carve-out, previously "deferred") and dropped the click-through +
row-fill + caption that this spec now restores. Reuses §4 / §C vocabulary; no new DESIGN.md
departure (§C-3 ambient row-fill and §C-4 `whileInView` entrance are already recorded).

**Data contract** (`usage:overview` gains a `skills` field — **always present**, unlike `cost`):

```ts
skills: SkillStats
interface SkillStats {
  last24h: SkillStatsWindow
  last7d: SkillStatsWindow
  last30d: SkillStatsWindow
  pricedSessionsWithoutSkill: number // priced terminals no invocation resolves to — caption count.
                                     // Spans ALL cost-tracked history, not the selected window.
}
interface SkillStatsWindow {
  window: '24h' | '7d' | '30d'
  invocationCount: number
  skillCount: number
  sessionCount: number
  bySkill: { skillName: string; count: number }[] // count desc, skillName asc
  byTriggerType: { trigger_type: TriggerType; count: number }[] // fixed order: user_invoked, autonomous, subagent
  trend: { key: string; count: number }[] // 24 ISO-hour buckets (24h) or N local-date buckets (7d/30d), zero-filled
  associations: SkillCostAssociation[] // associatedCostUsd desc, then sessionCount desc, then skillName asc
}
interface SkillCostAssociation {
  skillName: string
  skillId: number | null // resolved skills row (global > project > synced) — click-through target
  sourceType: 'global' | 'project' | 'plugin' | null // null ⇒ no skills row ⇒ no click-through
  sessionCount: number // distinct source sessions in the window that fired the skill
  trackedSessionCount: number // distinct usable priced terminals those sessions resolve to
  associatedCostUsd: number // sum of those terminals' total_cost_usd (naive: whole-session)
  associatedOutputTokens: number // sum of those terminals' session_model_cost.output_tokens
}
```

## S1. Section anatomy & order

```
── 960px rule-line, py-8 ─────────────────────────────────────────

Skills                    [ 24 hours | 7 days | 30 days ]  ← header row: 13px/600 ledger-ink +
                                                             inline segmented control (§S2)
                                                           (gap-6)
Invocations   Skills used   Sessions                        ← three flat stat cells, --usage-stat
                                                           (gap-6)
INVOCATIONS OVER TIME       ← chart label 11px uppercase muted
[ InvocationTrend ]           bar-per-bucket, last bucket outlined (incomplete)
                                                           (gap-6)
TOP SKILLS
[ RankedList ]                bySkill, count desc
                                                           (gap-6)
HOW THEY WERE INVOKED
[ RankedList ]                byTriggerType, fixed order
                                                           (gap-6)
SESSION ASSOCIATION
Association, not attribution. Each session is counted …     ← caption ABOVE the table (§S4)
{n} cost-tracked sessions invoked no skill …                ← caption line 2, only when n > 0
[ SkillAssociationTable ]     (§S3)
```

Vertical rhythm, the 960px rule-line, `px-6`, and the empty/loading gate inherit §2.3–2.4 / §6.
Section entrance is the `whileInView` / `viewport={{ once: true }}` below-fold treatment from
§4.2 / §C7 — `initial={{ opacity: 0, y: 8 }}`, 320ms `easeOut`, `useReducedMotion()` guard.

## S2. Window control

The header row owns an inline segmented control — `role="radiogroup"`, 1px `border-border`
wrapper, active `bg-muted text-foreground`, inactive `text-muted-foreground` — labels **"24
hours" / "7 days" / "30 days"**. Independent of §3's page-global control: changing one never
changes the other. **Default: 30 days.** Stat numerals roll and trend bars re-rise (320ms) on
window change; `useReducedMotion()` snaps both.

`pricedSessionsWithoutSkill` (§S4 line 2) does **not** move with this control — it is a top-level
`SkillStats` field spanning all cost-tracked history, like Cost (§3 carve-out).

## S3. The table — `<SkillAssociationTable>` (`components/usage/SkillAssociationTable.tsx`)

A semantic `<table className="table-fixed w-full min-w-[620px]">` with a real `<thead>`/`<th>`.
**Not** `@tanstack/react-table` (locked to the skills inventory; overkill for a ≤~50-row
non-interactive list) and **not** an extension of `RankedList` (2-column, shared with Activity +
Cost). `2f1b552` moved this from a CSS grid of divs to a real table for the `<th>` semantics;
this spec keeps that.

- **Columns:** `Skill` (flex, truncates) · `Tracked / all` (`w-28`) · `Output tokens` (`w-32`) ·
  `Associated cost` (`w-28`). Header row 11px uppercase muted, `border-b border-border`; numeric
  headers right-aligned.
- **Data row:** `<tr className="group relative h-8 border-b border-border last:border-b-0">`.
  - **Ambient fill:** an absolute left-anchored `<span>` inside the first `<td>`, anchored to the
    `position: relative` `<tr>`, `width: {associatedCostUsd / maxRow}%` — **RankedList's exact
    tint** (`bg-usage-bar/[0.07]` → `group-hover:bg-usage-bar/[0.11]`, dark `/[0.12]` → `/[0.17]`,
    `minWidth: 2` for any non-zero value). Renders at final width (no grow). Share of **max**, not
    of total — a cost column has one dominant row. It is a tinted row, not a bar (§C-3).
    `ponytail:` comment records that table-row containing blocks are Chromium-only, which is all
    Megatron ships.
  - **Skill cell:** `skillName` (`truncate`, 13px) + a muted `sourceType` tag (11px) when
    non-null. When `skillId !== null` **and** an `onSelectSkill` handler is wired, the name is a
    `<TextLink>` (in-app-nav link — underline sweep, `focus-visible`); otherwise plain text. The
    same build-node-once / wrap-conditionally shape as `PluginDetail.tsx`'s labelled links.
  - **Tracked / all:** `{formatCount(trackedSessionCount)} / {formatCount(sessionCount)}`,
    right-aligned, 12px Geist Mono `tabular-nums`, muted; `title` spells it out.
  - **Output tokens:** `formatCount`, right-aligned, 12px mono muted.
  - **Associated cost:** `formatUsd(v, { cents: true })` — or `—` when `trackedSessionCount === 0`
    — right-aligned, 12px mono, text ink (the emphasised column; the ambient fill encodes it).
- **`INITIAL_ROWS = 8`** head + a `+ N more skills` button-row that fades in (0.15s). Payload
  order (associated-cost desc). No client-side sort controls.
- **Click-through:** `onSelectSkill?: (skillId: number) => void` threaded `App.tsx` →
  `<UsageView>` → `<SkillsSection>` → `<SkillAssociationTable>`. `App.tsx` passes
  `openDetailFromAnywhere`, which clears the sidebar filter (so "back" from the detail lands on a
  list that contains the skill) then switches to the Skills section and opens `SkillDetail` — the
  same helper the command palette and context-budget dialog use.

**Association math** (mirrors `getSkillStats` in `queries.ts`): for every skill, dedupe its
invocation rows (within the window) to sessions; resolve each session forward through
`continued_in_session_id` to its one usable priced terminal (`resolvePricedTerminal` — the same
lineage rule `getCostStats` uses); dedupe terminals; sum their `total_cost_usd` and
`output_tokens`. A session that fired three skills contributes its whole totals to all three rows,
so **association rows must never be summed into a global total**. Zeroed, broken, and cyclic
lineages — and sessions with no `cost-state` at all — contribute nothing to $ or tokens but still
count toward `sessionCount` and the invocation stats.

## S4. Caption (every string)

Above the table, `text-[11px] text-muted-foreground max-w-[520px]`, `flex flex-col gap-2`.
Placement is **above** the table (departs from the old §D "below"): the disclosure should be read
before the numbers, not after.

**Line 1 (always) — mechanism, never a ratio:**

> Association, not attribution. Each session is counted under every skill it invoked, so these
> rows overlap and add up to more than the tracked-window total. This shows which skills tend to
> run inside expensive sessions — not what a skill "costs."

**Line 2 (only when `pricedSessionsWithoutSkill > 0`):**

> {n} cost-tracked session(s) invoked no skill and {isn't / aren't} shown here — counted across
> all tracked history, not the selected window.

`n` comes straight from `skills.pricedSessionsWithoutSkill` (server-computed — a client
subtraction is wrong because the rows overlap).

## S5. Empty & loading states

| Condition                              | Render                                                                                                                 |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `window.invocationCount === 0`         | Heading + window control + zero-valued stat cells stay; each `ChartBlock` shows "No skill invocations in the last {window}." Never takes over the page's empty state. |
| `data.skills` absent (pre-scan)        | `UsageSkeleton`'s Skills block: a heading + control bar, three stat cells, a `h-[72px]` trend bar, ~5 list rows.       |

Windows are independent: 24h can be empty while 30d is populated. No `cost === null` special-case
— the association table degrades per-row (`—` in the cost column) when a skill's sessions have no
usable cost data.

## S6. Responsive & motion

- Fluid. The three numeric columns are ~7rem + 8rem + 7rem; the skill name flexes and truncates
  below that. The table has `min-w-[620px]` inside an `overflow-x-auto` guard; Megatron's
  supported minimum window normally shows all columns without scrolling.
- Motion: section entrance on scroll-into-view (§C7); trend bars rise 320ms (`easeOut`, ≤12ms/bar
  stagger); `RankedList` rows fade in; ambient fills render at final width and deepen one notch on
  row hover; the "+ N more" button fades. All guarded by `useReducedMotion()`.
- Monochrome — the `--usage-series-*` model palette never bleeds here (§C3 scope: by-model charts
  only).

## S7. DESIGN.md departures

None new. Inherits §8 (960px cap, `--usage-stat`, 13/600 headers, `--usage-*` tokens, charts
animate), §C-3 (ambient row-fill tint), §C-4 (`whileInView` entrance). One deliberate divergence
from the old §D: the association caption sits **above** the table, not below.

## S8. Not in PR3

- **Proportional per-skill $ attribution** — the honest replacement for the naive Associated-cost
  column. Designed (`usage-analytics.md` PR4 rider), depends on `turn_usage`, **built in PR4**.
- **`turn_usage`-backed panels** (Model & effort, intra-session context-growth curve) — PR4.
