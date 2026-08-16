---
name: visual-verify
description: Use after implementing any UI change requested by the user — new component, layout change, new view, theme/state-handling change — to confirm it matches what was asked for, didn't break anything else, and holds up at every window size Megatron supports. Not for aesthetic critique or taste review; it checks conformance and breakage, not whether something looks good.
---

# Visual verify

Megatron is Electron + IPC/SQLite-driven — most of the UI has no content without a real running
app, so there's no way to "just look at the JSX" and know it renders, let alone whether it matches
what was asked. This skill builds the app, drives the real packaged output through every known
screen/state at every window size, and gives you the evidence (screenshots + a deterministic
overflow/console-error report) to judge against the actual request.

## Process

**1. Restate the requirement.** Before running anything, write down — in your own words, from the
conversation — exactly what UI change you just implemented. This is the yardstick everything below
gets checked against. Skipping this turns step 3 into "eyeball it and hope," which isn't the point.

**2. Run it.**

```
npm run verify:visual
```

This builds (typecheck included — a build failure is itself a finding, stop and read it), launches
the packaged app in a throwaway profile, and for every scenario in `scenarios.mjs` at every window
size Megatron supports, writes `.visual-verify/<scenario-name>--<size-label>.png`. Sizes are read
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

**3. Read everything and judge against the requirement from step 1.**

- **Read every PNG.** A screenshot nobody looked at verifies nothing. For each one, ask: does the
  intended change actually show up here the way it was asked for — not just "does something render."
- **Read the overflow/console-error summary.** These are deterministic, not judgment calls — any hit
  is a real finding, go look at the screenshot(s) it names.
- **Check both sizes, not just default.** Megatron is user-resizable down to its real minimum; a
  layout that only works at the default size is broken, not passing.
- **Check screens the current change didn't touch, not just the one it did.** Every scenario runs
  every time specifically so a shared-component or token change shows up here even though the edit
  was somewhere else.

**4. If you find a real defect caused by this change, fix it — once.** Fix the specific issue, then
re-run `npm run verify:visual` one more time to confirm. Whether the recheck comes back clean or not,
**stop there** — one fix-and-reverify cycle, full stop — and report the outcome with specifics rather
than continuing to iterate. This mirrors Impeccable's own bounded-pass principle (`SKILL.src.md:17`:
"Verify in bounded passes, not a loop... Open-ended self-QA burns the user's money doing worse what
the finish handoffs do better") — don't turn this into an open-ended repair loop.

A defect that's clearly **pre-existing and unrelated** to the current change (not something this
change caused) gets reported, not silently fixed as a drive-by — stay scoped to what you were asked
to verify.

**5. Clean up.** Once you've read the screenshots, judged them, and reported the outcome to the
user, delete `.visual-verify/` (`rm -rf .visual-verify`). It's gitignored, local, ephemeral evidence
for this one cycle, not a deliverable — the next run clears it anyway (see `verify.mjs`), but don't
leave it sitting in the working tree once its job is done. Exception: if you're about to hand the
screenshots to a deliberate `/impeccable critique` pass (see Scope below), keep them until that's
finished too.

## Keeping coverage current

**Implementing a UI change that adds a new screen, nav destination, or major state includes adding
its scenario to `scenarios.mjs` in the same change** — this is part of "done," not a follow-up. Each
entry is `{ name, run(window) }`: describe how to get from the app's default baseline state to the
state you want screenshotted (the runner reloads back to baseline before every scenario, so don't
assume another scenario ran first — see the comment at the top of `scenarios.mjs`).

## Scope — read this before reaching for more

This is a conformance/regression/responsiveness check, not a quality gate:

- **No assertions, no pass/fail wired into CI.** It captures and flags deterministic defects
  (overflow, console errors); you judge everything else. Don't wire this into `npm test`/`ci.yml` —
  see `docs/design-system.md`'s "Design QA tooling" section and the M1 renderer testing note in
  `CLAUDE.md` for why an assertion suite against a UI this young isn't worth it yet.
- **Not a taste/critique tool.** For "does this look _good_" (spacing, hierarchy, anti-slop
  patterns), that's a separate, deliberate call to Impeccable (`/impeccable critique`) — not
  something this skill should trigger automatically. The two don't compose today: Impeccable's
  browser-evidence path wants a localhost dev URL and explicitly warns against `file://`, which is
  how Electron's packaged renderer loads. If you're doing a deliberate taste pass, point Impeccable
  at the PNGs this script already wrote instead of re-deriving evidence.
