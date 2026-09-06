# Usage view — resolved UI spec (Phase 2a / PR1)

**Scope:** Activity section (full) + page frame future sections drop into + AppRail entry.
Later sections (Cost, Model & effort, Skills association, Resident tax) are **not** designed here —
only the frame they inherit.

**Status:** resolved in a grill session, 2026-09-05. Feeds megatron-6b's PR1 plan.
Design system base: `DESIGN.md` ("Inventory Ledger"). Departures are listed explicitly at the end.

---

## 1. AppRail entry

- New `AppSection` value `'usage'`, third position after `plugins` in `AppRail.tsx`'s `SECTIONS`.
- **Icon:** `BarChart3` (lucide). Label + tooltip: **"Usage"**.
- **Active state:** ink-fill (`bg-muted text-foreground`), same as the other two — **not lime**. No
  change to the rail's rules or the One Stamp Rule scope.
- `resolveInitialSection` (`src/main/theme.ts`) hardened to enum-validate and fall back to
  `'skills'` on an unknown stored value. *(megatron-6b plumbing — noted, not part of this spec.)*

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

| Side | Content |
|---|---|
| Left | `[BarChart3 size-3.5] Usage` — 13px/600 ledger-ink. **No "Claude Code" prefix** (that prefix earns its place on Skills/Plugins because they inventory Claude Code's assets across sources; Usage is unambiguously the user's own history). |
| Right | **7d/30d segmented toggle** (§3), then a muted `Updated 2h ago` derived from `activity.generatedAt`. The "updating…" pulse keys off a refetch being in flight *after the first successful load* (poll-until-`scanComplete`, see §6). |

### 2.3 Section model

The page is a flat vertical scroll of stacked sections. Fixed order, top→bottom:

1. **Activity** (PR1)
2. Cost *(PR2)*
3. Model & effort *(PR4)*
4. Skills *(PR3)*
5. Resident tax *(PR5)*

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

- **Section header: 13px / 600 ledger-ink** + optional 11px muted subtitle. *(Revised up from an
  earlier 11px-uppercase proposal — a 5-section scroll needs real structure, and 13/600 is still
  under the 16px ceiling.)*
- **Per-chart label inside a section: 11px uppercase muted** (`label-column` token) — e.g.
  "By day", "By time of day", "By project". Two-level hierarchy: section 13/600 → chart 11/upper.
- No per-section actions, no collapse/expand, no in-header jump-nav (revisit jump-nav in the PR
  that adds section #4, not now).
- Rule-lines between sections are **960px wide** (match content), not full-bleed into the empty
  right gutter.

### 2.4 Vertical rhythm

| Gap | Value |
|---|---|
| Between sections | `py-8` (32px) + 960px rule-line |
| Section header → content | `gap-6` (24px) |
| Within section, stat row → each chart block | `gap-6` (24px) |
| Chart label → chart | `gap-2` (8px) |
| Section horizontal padding | `px-6` |

---

## 3. 7d / 30d toggle

- **Placement:** right side of the pinned header, before "Updated".
- **Style:** segmented control **identical to `SettingsDialog`'s appearance switch** —
  `role="radiogroup"`, 1px `border-border` wrapper, active item `bg-muted text-foreground`
  (ink-fill, **not lime**), inactive `text-muted-foreground`. Two options, labels **"7 days" /
  "30 days"** (words, not "7d").
- **Default: 30 days.** (One-line change to open on 7.)
- **Scope: page-global**, governs the windowed sections — Activity now; Cost & Model/effort when
  they land. Two carve-outs by design:
  - **Skills section brings its own inline control** — it needs *24h* / 7d / 30d (a different
    option set per `usage-analytics.md`), so it owns that control rather than distorting the
    global one.
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
*line* chart ever ships — evaluate `d3-shape` alone or `uPlot` then, never a full framework.

Build a small reusable vocabulary in `src/renderer/src/components/usage/`: a `<BarRow>` primitive,
a `<HeatCell>` grid, shared axis/label helpers. ~100–150 lines total.

### 4.1 Ink tokens (new — additive, monochrome, no hue)

| token | light | dark | use |
|---|---|---|---|
| `--usage-bar` | `oklch(0.145 0 0)` | `oklch(0.985 0 0)` | default bar fill |
| `--usage-bar-quiet` | `oklch(0.70 0 0)` | `oklch(0.45 0 0)` | context / de-emphasized bars |
| *(track)* | `--surface-muted` | `--surface-muted` | unfilled rail — horizontal bars only |

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

| Moment | Behavior | Timing | Reduced-motion |
|---|---|---|---|
| **Enter** | bars rise from baseline (`scaleY 0→1`), staggered | 320ms `easeOut`, 12ms/bar, whole strip ≤ 600ms | snap to final |
| **Bar hover** | one **shared glide indicator** springs between bars (reuse `useGlideHighlight`: stiffness 500 / damping 40) — 1px ink outline on the bar + value label riding above it | spring | indicator jumps, no glide |
| **Scrub** (hour strip + by-day strip only) | pointer anywhere over the plot snaps the glide to the nearest bar + a 1px `rule-line` vertical guide follows the cursor | spring | guide snaps |
| **Sibling focus** (by-weekday marginal + by-project only — small N) | non-hovered bars fade to `--usage-bar-quiet` @ 55% while one is hovered | 150ms | none |
| **7d ↔ 30d switch** | bars interpolate to new heights (spring); strip charts cross-fade the bar count; **stat numerals roll** to the new value | ~450ms | numerals snap, bars swap |

- The 24-bar hour context and the by-day strip **skip sibling-focus** — too twitchy at that density.
- **Stat-numeral roll fires on window-switch only** — NOT on mount.
- The **7d↔30d switch is the signature moment** — the whole page visibly "retunes" in one
  coordinated spring.
- Every `motion` use guards `useReducedMotion()` explicitly (Motion-Earns-Its-Keep Rule).

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
*or* weekend skew but never "Saturday afternoons + late weeknights" — this user's actual pattern
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
  *is* the point.
- Hover: sibling-focus dim + row highlight. **Not clickable in PR1** (a "filter the whole page to
  one project" feature is real but out of scope).
- **Note for megatron-6b / later:** `usage-analytics.md` §2 eventually pairs activity-by-project
  with cost-by-project. For PR1 it lives in Activity; PR2 decides whether they merge.

---

## 6. Empty & loading states

**Two distinct empty cases:**

1. **No `history.jsonl` at all** — centered `BarChart3` (muted, size-8) + "No activity yet" +
   one line: "Megatron reads your prompt history from `~/.claude/history.jsonl`. It'll show up
   here after your next Claude Code session and a rescan." **No CTA** (not actionable).
2. **`history.jsonl` exists but the selected window is empty** (a quiet week) — *not* the empty
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

| # | Departure | Justification |
|---|---|---|
| 1 | **Content capped at `max-w-[960px]`** (left-aligned) — `DESIGN.md` says max-width is `none` everywhere except 72ch markdown prose | Usage is a *report you read*, not a *table you scan* — same rationale as the prose cap. Wall-to-wall charts on a 1600px window is the "dashboard performing busyness" the doc rejects. |
| 2 | **`--usage-stat` type token at 30px** — above the 16px/600 No-Hero-Type ceiling | Scoped exclusively to the 3–4 primary stat numerals in the Usage view. Mono keeps it inside the "Geist Mono for data/token-counts" principle — only *size* departs. A 5-section retrospective is a different surface class from the dense list/detail UI the rule governs. |
| 3 | **Section headers at 13px/600 ledger-ink** where existing surfaces would use a quieter divider | A 5-section vertical scroll needs top-of-section structure. Still under 16px. |
| 4 | **Two new monochrome ink tokens** (`--usage-bar`, `--usage-bar-quiet`) + a **quantile opacity scale** for the punchcard | `DESIGN.md` gives lime=reserved and flags=status-only with no neutral data ink. Both additions stay inside the "near-monochrome" discipline — no hue, no second accent. |
| 5 | **Charts animate on enter / scrub / window-switch** more than most surfaces | Covered by the existing Motion-Earns-Its-Keep Rule ("not fixed to today's call sites, can grow into new surfaces as they earn it"). All guarded by `useReducedMotion()`. |

Not departures: no sidebar on Usage (Plugins already runs without its own in the DESIGN.md text),
ink-fill rail active state (unchanged), Ledger-Lies-Flat (no cards, no rest shadows — floating
tooltips may cast one), every-signal-paired-with-icon (charts carry labels/axes, not color-alone
status).

---

## 9. Summary of asks for megatron-6b

1. **Contract:** `byHourWeekday: number[][]` (7×24, local, row 0 = Sunday) on `ActivityWindow` —
   *confirmed in the plan; `getActivityStats` computes it in the same reduce pass and derives
   `byHour`/`byWeekday` from it.* `byDay[]` entries also carry `weekday: number` (0 = Sunday,
   server-computed) — the renderer uses that for the weekend band, never re-parsing `date`.
2. `AppSection` gets `'usage'`; `AppRail` `SECTIONS` gets the `BarChart3` entry, third.
3. `App.tsx` binary branch → three-way; `usage` = rail + `<UsageView/>`, no sidebar.
4. `resolveInitialSection` enum-hardening.
5. `usage:overview` returns **`{ activity, scanComplete }`**; `activity` carries both `last7d` and
   `last30d` (renderer toggles client-side) plus `generatedAt`. Poll-until-`scanComplete` at 750ms,
   `['usage']` in the `onScanComplete` invalidation list.
6. New renderer files: `src/renderer/src/views/UsageView.tsx` + `src/renderer/src/components/usage/`
   (chart vocabulary). Two new CSS tokens + `--usage-stat` type step in the renderer's theme.
