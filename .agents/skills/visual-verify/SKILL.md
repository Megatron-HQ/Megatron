---
name: visual-verify
description: Use after any change under `src/renderer/`, or a change in `src/main/`, `src/preload/` or `src/shared/` that a screen displays, to see the result and check it against what was asked. Renders component fixtures in headless Chrome and compares them with the base commit. Checks conformance and breakage, not taste.
---

# Visual verify

A **fixture** is one named state of one component, rendered on synthetic data in headless Chrome at both window sizes and in both themes. `check` renders the base commit again on this machine and reports what differs, so there are no stored baselines and nothing to promote. Decisions, rejected alternatives and gaps live in `docs/ui-verification.md`.

`npm run fixtures -- <mode>` takes `list`, `shot`, `check` and `serve`; run it bare for usage. A filter is any part of a fixture id (`SkillInventory`, `App/LoadError`). Output lands in `.fixtures/`.

## Process

1. **Shoot while building.** `npm run fixtures -- shot <filter>` prints one PNG path per size and theme; Read them. Shots are free, so take them as often as they help. They prove nothing on their own.
2. **Give every state the change adds or alters a fixture**, in the same change. See "Writing a fixture".
3. **Finish with one full check:** `npm run fixtures -- check`, no filter. A filtered check skips the UNCOVERED and WARNING lines, so it cannot finish the work. Done means exit 0 and every line below read:
   - `ERROR`: a render error, console error, failed request, horizontal overflow, or a failed `interact` step. Fix the code or the fixture.
   - `CHANGED`: Read the composite it names (before, after, diff, left to right). Each must be a change the request asked for.
   - `NEW`: Read the shot. It must show the state its name claims.
   - `UNCOVERED`: a component no fixture imports. Add its fixture file. `scripts/fixtures/pending.json` only shrinks, so listing the component there is not a fix.
   - `STALE`: delete that entry from `pending.json`.
   - `WARNING`: an edited file whose fixtures all rendered the same. If the edit was meant to be visible, the state it changes has no fixture yet; add one.
4. **Three fix rounds at most.** If the third full check still fails, stop and report what fails and what you tried.
5. **A change in `src/main/`, `src/preload/` or `src/shared/` also runs `npm run smoke:app`.** Fixtures replace all three with a fake, so only the real app can show they still work.
6. **Report** the final check's summary line, the changed and new fixtures you read, and anything in "What fixtures cannot show" that the change depends on.

## Writing a fixture

`X.fixture.tsx` sits beside `X.tsx`. Each named export is one fixture; its id is the path under `src/renderer/src/` plus the export name (`views/SkillInventory/RowHover`).

```tsx
export const StaleTooltip = fixture({
  frame: sheet('skills'),
  render: () => (
    <SkillInventory
      skills={baseSkills}
      filter={{ kind: 'all' }}
      loading={false}
      onSelect={ignore}
      onOpenSearch={ignore}
    />
  ),
  interact: async (user) => {
    await user.hover({ selector: 'tbody svg.lucide-clock' })
    await user.until({ text: 'Not run in the last 30 days' }, 'The stale icon showed no tooltip.')
  }
})
```

- **`frame`** places the component where the app puts it: `sheet(section)` for a screen, `sidebar(section)` for a sidebar, `'window'` for a fixture that renders `<App />`.
- **Component or whole app.** Render the component with props when the state is the component's own. Render `<App />` when the state exists only through App's wiring (a banner, a sidebar selection, an event from the main process) and for every behaviour that crosses screens.
- **`api`** replaces members of the fake `window.api`. Data comes from `src/renderer/src/fixtures/data.ts`: typed, synthetic, never read from `~/.claude`. A data call the fixture gives no data fails the check by name. `emit()` from `fixtures/fake-api.ts` stands in for a main-process event.
- **`interact`** drives real browser input: `click`, `hover`, `press`, `type`. `until(target or function, message)` is the pass/fail step. End a behaviour on the `until` that proves it, with a message that states what broke.
- **Time is frozen** at 2026-06-15 12:00 UTC. Derive every timestamp from `Date.now()` (`daysAgo()` in `data.ts`).

## What fixtures cannot show

Scrollbars, the window frame and title bar, Windows font rendering, the Content-Security-Policy, the production bundle, and anything the real preload, IPC, scan worker or SQLite does. For those, run `npm run smoke:app` or `npm run dev` and say in the report that fixtures did not cover it.
