---
name: visual-verify
description: Use after implementing any UI change requested by the user — new component, layout change, new view, theme/state-handling change — to confirm it matches what was asked for, didn't break anything else, and holds up at every window size Megatron supports. Not for aesthetic critique or taste review; it checks conformance and breakage, not whether something looks good.
---

# Visual verify

Megatron is Electron + IPC/SQLite-driven — most of the UI has no content without a real running
app, so there's no way to "just look at the JSX" and know it renders, let alone whether it matches
what was asked. This skill builds the app, drives the real packaged output through every known
screen/state at every window size, and gives you the evidence (screenshots, a diff against each
screenshot's last-accepted baseline, and a deterministic overflow/console-error report) to judge
against the actual request.

## Process

### Scope the run

By default, capture only the screens your change can reach — not all 37 scenarios. The full sweep
is one flag away, and still required before you wrap up (see "Before wrapping up").

Run the **full sweep** — `npm run verify:visual`, no `--only` — when any of these hold:

- `git diff --name-only` touches a globally shared surface: `src/renderer/src/assets/main.css`,
  `src/renderer/src/components/ui/**`, `src/renderer/src/App.tsx`, or
  `src/renderer/src/components/AppRail.tsx`. These restyle or wrap every screen — this **overrides
  the table below**.
- the change is under `src/main/` or `src/shared/` in a way that alters what a screen displays.
- the user asked for a full audit.
- you're not certain which screens the change reaches.

Otherwise **scope it** — `npm run verify:visual -- --only <screen>,<screen>` — mapping your changed
files to screens:

| Changed file(s)                                                                       | `--only` screen(s)               |
| ------------------------------------------------------------------------------------- | -------------------------------- |
| `views/SkillInventory.tsx`, `components/ClaudeIcon.tsx`                               | `skill-inventory`                |
| `views/SkillDetail.tsx`                                                               | `skill-detail`                   |
| `views/SkillFileViewer.tsx`, `components/FileTree.tsx`, `components/MarkdownView.tsx` | `skill-file-viewer`              |
| `components/SourceBadge.tsx`, `components/LintStatusBadge.tsx`                        | `skill-inventory,skill-detail`   |
| `components/LintFindingsPanel.tsx`                                                    | `skill-detail,skill-file-viewer` |
| `components/Sidebar.tsx`                                                              | `sidebar`                        |
| `components/ContextBudgetDialog.tsx`                                                  | `context-budget-dialog`          |
| `components/CommandPalette.tsx`                                                       | `command-palette`                |
| `components/SettingsDialog.tsx`                                                       | `settings-dialog`                |
| `views/PluginInventory.tsx`                                                           | `plugin-inventory`               |
| `views/PluginDetail.tsx`                                                              | `plugin-detail`                  |
| `components/PluginBadges.tsx`                                                         | `plugin-inventory,plugin-detail` |

A changed file **not in this table → run the full sweep.** (`ManageFoldersDialog.tsx` and
`PluginActionToasts.tsx` have no scenario at all — a pre-existing coverage gap, not something
scoping introduced.) A scenario you added this change runs even if you don't name its screen (it
has no baseline yet), but name its screen in `--only` anyway.

The runner validates `--only` before it builds: an unknown screen name exits immediately with the
valid list. A scoped run prints a `SCOPED RUN` banner at both ends of its summary and suppresses the
orphaned-baseline check (which only means something on a full run).

**1. Restate the requirement.** Before running anything, write down — in your own words, from the
conversation — exactly what UI change you just implemented. This is the yardstick everything below
gets checked against. Skipping this turns step 3 into "eyeball it and hope," which isn't the point.

**2. Run it.**

```
npm run verify:visual -- --only <screen>,<screen>   # scoped — the default (see "Scope the run")
npm run verify:visual                               # full sweep
```

This builds (typecheck included — a build failure is itself a finding, stop and read it), launches
the packaged app in a throwaway profile, and for every scenario in scope (all of `scenarios.mjs`,
unless you passed `--only`) at every window size Megatron supports, writes
`.visual-verify/<scenario-name>--<size-label>.png`. Sizes are read
live from the real `BrowserWindow` config (`default` = initial launch size, `min` =
`getMinimumSize()`), not hardcoded, so they can't drift out of sync with `src/main/index.ts`. It also
prints a summary of any horizontal overflow (a real bug on this desktop app, always) and any console
errors / uncaught page errors seen during the run.

Isolation: it launches with `--user-data-dir` pointed at a temp directory, so it never touches your
real `userData`/db and can't collide with a `npm run dev` session you already have open. The
scanners still read real `~/.claude` data, so the screenshots show real skills, not fixtures.

**The window flashing open and closing in a few seconds is expected, not a hang.** Playwright drives
the clicks at automation speed, not human speed. The script logs each step as it goes
(`capturing <name>...`) — watch the terminal, not the window.

**Reading a diff result.** Every screenshot is also pixel-diffed against its stored baseline in
`.visual-verify-baselines/` (gitignored, persists across runs — unlike `.visual-verify/`, which gets
wiped every run). The threshold (`0.1`, antialiasing excluded) and the diff-pixel floor (`2000`px)
are fixed in `verify.mjs`, so "unchanged" means the same thing every time regardless of who's running
it — not re-tuned per run. The floor isn't a guess: the capture window emulates
`prefers-reduced-motion` so the app's JS-driven spring animations (hover-glide, file-tree
expand/collapse) render instantly instead of needing a wait long enough to outlast an unreliable
frame rate, and even so, repeated identical runs still showed up to ~650 pixels of ordinary subpixel
font-rendering jitter. `2000` clears that with real margin. Each screenshot lands in one bucket:

- **new** — no baseline exists yet (a first run, or a newly added scenario). Always review.
- **changed** — differs from the accepted baseline by more than the floor, or its dimensions don't
  even match the baseline (e.g. a DPI change) and no pixel comparison was possible. Always review.
- **unchanged** — matches the accepted baseline. Nothing new here — skip reading it.

On a **full** run the runner also prints any **orphaned baselines** — files in
`.visual-verify-baselines/` with no matching scenario (a sign a scenario was renamed or removed).
Nothing is deleted automatically: an automated sweep can't reliably tell a rename from a deletion, so
it's surfaced for you to deal with by hand if it's worth the five minutes. A scoped run skips this
check — it can't tell an orphan from a screen it simply didn't capture.

**3. Read everything and judge against the requirement from step 1.**

- **Read every screenshot flagged `new` or `changed`.** A screenshot nobody looked at verifies
  nothing. For each one, ask: does the intended change actually show up here the way it was asked
  for — not just "does something render." Screenshots flagged `unchanged` don't need re-reading —
  they already matched a state you (or a prior session) already judged correct.
- **`unchanged` means "nothing new to look at," never "verified."** The diff has no idea whether a
  change matches what was actually asked for — it only knows pixels didn't move. Don't let a clean
  diff summary become a reason to skip judgment on the screenshots that _are_ flagged.
- **Watch for data drift, not just UI drift.** Scenarios read real `~/.claude` data, not fixtures —
  a skill count, a last-used timestamp, or a recency-sorted list can shift between two runs with zero
  code change in between. If a flagged diff is confined to that kind of live content rather than
  layout/style, treat it as `DATA DRIFT — not a regression`: note it, don't promote it (see step 5),
  and move on — it's not a finding.
- **Read the overflow/console-error summary.** These are deterministic, not judgment calls — any hit
  is a real finding, go look at the screenshot(s) it names. This runs on every screenshot regardless
  of its diff status.
- **Check both sizes, not just default.** Megatron is user-resizable down to its real minimum; a
  layout that only works at the default size is broken, not passing.
- **Check every screen your change can reach, not just the one you edited.** A scoped run captures
  the screen you changed plus any screen a shared component you touched renders on (the `--only`
  table) — and deliberately skips the rest. The closing full run ("Before wrapping up") is what
  re-checks those for a shared-component or token regression. On a full run every scenario is
  captured, and the baseline diff keeps that cheap by flagging only what actually moved.

**4. If you find a real defect caused by this change, fix it — once.** Fix the specific issue, then
re-run the same command (scoped or full, whichever you ran) one more time to confirm. Whether the
recheck comes back clean or not,
**stop there** — one fix-and-reverify cycle, full stop — and report the outcome with specifics rather
than continuing to iterate. This mirrors Impeccable's own bounded-pass principle (`SKILL.src.md:17`:
"Verify in bounded passes, not a loop... Open-ended self-QA burns the user's money doing worse what
the finish handoffs do better") — don't turn this into an open-ended repair loop.

A defect that's clearly **pre-existing and unrelated** to the current change (not something this
change caused) gets reported, not silently fixed as a drive-by — stay scoped to what you were asked
to verify.

**5. Promote the screenshots you just accepted.** For each `new`/`changed` screenshot you judged
correct in step 3 (not `DATA DRIFT`, not something you're about to fix in step 4), copy it from
`.visual-verify/<name>.png` to `.visual-verify-baselines/<name>.png` — that's what makes the next run
recognize it as `unchanged` instead of flagging it again. Only promote what you actually reviewed,
not a blanket copy of everything. Do this **before** cleanup below — step 6 deletes the directory
you'd be copying from.

**6. Clean up.** Once you've read the screenshots, judged them, promoted what was accepted, and
reported the outcome to the user, delete `.visual-verify/` (`rm -rf .visual-verify`). It's gitignored,
local, ephemeral evidence for this one cycle, not a deliverable — the next run clears it anyway (see
`verify.mjs`), but don't leave it sitting in the working tree once its job is done.
`.visual-verify-baselines/` is untouched by this — it's meant to persist across runs. Exception: if
you're about to hand the screenshots to a deliberate `/impeccable critique` pass (see Scope below),
keep them until that's finished too.

## Before wrapping up

If any run this cycle was scoped (`--only`), do **one full `npm run verify:visual`** before calling
the UI change done — it's the single look a shared-component or token regression on an untouched
screen gets before it ships. Read the newly-flagged screenshots and promote as usual. Skip this only
if the change never went near a shared surface (per "Scope the run") — in which case you were
running full the whole time anyway.

## Keeping coverage current

**Implementing a UI change that adds a new screen, nav destination, or major state includes adding
its scenario to `scenarios.mjs` in the same change** — this is part of "done," not a follow-up. Each
entry is `{ name, screen, run(window) }`: `screen` is one of the nine names in the "Scope the run"
table (or an array, for a scenario guarding an interaction between two screens); `run` describes how
to get from the app's default baseline state to the state you want screenshotted (the runner reloads
back to baseline before every scenario, so don't assume another scenario ran first — see the comment
at the top of `scenarios.mjs`). A scenario with no `screen` is invisible to `--only` —
`scenarios.test.mjs` fails if one is missing. A renamed or removed scenario's old baseline shows up
in the next **full** run's orphaned-baselines report — no action required, it's just visibility, not
a cleanup obligation.

## Scope — read this before reaching for more

This is a conformance/regression/responsiveness check, not a quality gate:

- **No assertions, no pass/fail wired into CI.** It captures and flags deterministic defects
  (overflow, console errors); you judge everything else. Don't wire this into `npm test`/`ci.yml` —
  see the M1 renderer testing note in `CLAUDE.md` for why an assertion suite against a UI this young
  isn't worth it yet.
- **Not a taste/critique tool.** For "does this look _good_" (spacing, hierarchy, anti-slop
  patterns), that's a separate, deliberate call to Impeccable (`/impeccable critique`) — not
  something this skill should trigger automatically. The two don't compose today: Impeccable's
  browser-evidence path wants a localhost dev URL and explicitly warns against `file://`, which is
  how Electron's packaged renderer loads. If you're doing a deliberate taste pass, point Impeccable
  at the PNGs this script already wrote instead of re-deriving evidence.
