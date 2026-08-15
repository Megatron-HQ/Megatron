# Megatron: Design System

Reference for UI work. Captures the design decisions made before any renderer screen existed,
so `SkillInventory.tsx` and everything after it has a concrete system to build from instead of
improvised per-component choices. `CLAUDE.md`'s Locked-decisions table remains authoritative for
architecture; this doc is the UI-specific layer underneath it, same relationship
`docs/mvp-build-spec.md` has to `CLAUDE.md`.

This revision closes the branches the first draft left open — window chrome, density, type
scale, elevation, badge iconography, and accessibility — via a dependency-ordered interview
(each answer constrained the next: window chrome before sidebar contents, sidebar contents
before the active-state indicator, elevation before detail-panel mechanics, badge icon language
before the read-only marker). Resolved in that order below.

## Shell / information architecture

**Sidebar + list/detail, Linear-style.** Persistent left sidebar, main pane is the dense skills
table, clicking a row opens a right-side detail panel (lint findings, usage stats, source tier).
No command-palette-primary navigation, no marketing-page patterns — Megatron is a single-domain
utility app (CLAUDE.md's scope is deliberately "skills only, no sessions/repo UI"), not a
multi-section product with enough distinct surfaces to justify heavier navigation chrome.

Command palette (`cmdk`, matching shadcn's `Command` component): **built, post-M2.** Was deferred
during M2 itself (not a requirement of M2's actual scope — `docs/mvp-build-spec.md`: "list every
skill... tagged by origin"), with an explicit revisit trigger: "once the table has enough rows to
make browsing alone insufficient." That trigger fired — 31 real skills on the dev machine (25
global + 6 plugin) is past one screenful — surfaced while comparing Megatron against
`references/skills-manager`. `⌘K`/`Ctrl+K` opens a `CommandDialog` searching all skills by name and
description regardless of the active sidebar filter; selecting one opens its detail panel. Uses
cmdk's built-in filtering, no custom matcher.

This does **not** reopen the sidebar's "no search box" lock below — that line rules out inline
search chrome living in the sidebar itself; the palette is a modal dialog, a different surface, and
the row-count reasoning behind both was always "add when the data justifies it," not "search is
wrong."

### Window chrome

Electron's `BrowserWindow` currently uses the plain default frame (`src/main/index.ts` — no
`titleBarStyle` set, standard OS titlebar). Locked: **`titleBarStyle: 'hiddenInset'`.** Traffic
lights float over the sidebar's top-left corner instead of a full OS titlebar row eating vertical
space above the app — this is what Linear/Slack/Notion desktop actually do, and it's the concrete
reason the sidebar needs its top nav item padded below macOS's traffic-light hit zone (~28px)
rather than starting flush at the top edge. Nothing here justifies going further into a fully
custom frameless window with hand-drawn window controls — `hiddenInset` alone gets the effect.

### Sidebar composition

Not specified before this pass beyond "persistent left sidebar." Locked contents, top to bottom:
app wordmark ("Megatron"), a static filter nav (`All Skills` / `Global` / `Project` / `Plugin` —
filtering the table by `source_type`, the one dimension CLAUDE.md's locked-decisions table
already treats as structural), a flex spacer, and a light/dark toggle pinned at the bottom. No
search box (table doesn't need one yet at current row counts — same reasoning as "no
virtualization yet" under Data table below), no settings gear (nothing to configure in a
read-only v1).

The nav's active-state indicator is the lime accent — this is the "one selected/active-state
indicator" use case the Color section below already reserved lime for, now assigned concretely
instead of left abstract.

### Detail panel

Docked, not floating — opening a row's detail panel narrows the table pane rather than
overlaying it with a scrim (see Elevation: a docked panel separates with a border, not a shadow).
Fixed width, **360px**, not resizable — no drag-handle complexity earns its keep in a v1
read-only app. Closes via **Esc or an explicit `×` button** in the panel header; clicking
elsewhere does _not_ dismiss it — clicking a different table row swaps the panel's content
instead of losing your place to a stray click that missed a row by a couple pixels.

## Layout & density

No spacing/sizing scale existed before this pass. Locked, calibrated for a dense Linear-style
table rather than a spacious admin dashboard:

| Element            | Value                                                                       |
| ------------------ | --------------------------------------------------------------------------- |
| Base spacing unit  | Tailwind's default 4px scale, unchanged — nothing here needs a custom scale |
| Sidebar width      | 220px, fixed                                                                |
| Table row height   | 36px                                                                        |
| Table cell padding | 8px / 12px                                                                  |
| Detail panel width | 360px, fixed (see Shell above)                                              |
| Content max-width  | None — fluid, fills the window                                              |

## Color

Base: shadcn `new-york` / `neutral` (already committed in `components.json`, not revisited).

| Role                | Value                               | Notes                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accent              | Acid lime `#E4F222`                 | **Narrow use only** — primary action buttons and one selected/active-state indicator (now concretely: the sidebar's active filter-nav item, see Shell above). Never body text or links, especially in light mode: text-weight lime on a light background tested genuinely hard to read (verified in a rendered comparison, not assumed). Filled buttons with dark text on lime hold contrast fine in both themes. |
| Error / destructive | shadcn `--destructive` (existing)   | Lint errors                                                                                                                                                                                                                                                                                                                                                                                                       |
| Warning             | New `--warning` token, amber family | Lint warnings — add alongside `--destructive` in `main.css`, same pattern                                                                                                                                                                                                                                                                                                                                         |
| Success             | New `--success` token, green family | Passing lint / up to date                                                                                                                                                                                                                                                                                                                                                                                         |

Rules carried over from evaluating (and rejecting) Taste Skill's general anti-slop guidance for
this project — these are the parts that generalize past its landing-page-specific rules (see
"Design QA tooling" below for why most of that skill doesn't apply here):

- One accent, used sparingly — not painted across primary chrome. Matches the
  `ui.shadcn.com`-level minimalism this doc is calibrated to.
- No pure white/black. Current `main.css` light-mode background is literally `oklch(1 0 0)`
  (pure white) — replace with a slightly off-white value when M2 touches `main.css` (e.g.
  something in the `oklch(0.99 0 0)` neighborhood; exact value is an implementation detail for
  whoever writes that change, not pre-specified here). Dark mode's `oklch(0.145 0 0)` is already
  off-black, no change needed there.
- Status colors (red/amber/green) must stay visually distinct from the accent — this is _why_
  lime was chosen narrowly rather than as a broad UI color: none of red/amber/green/lime are
  confusable at a glance.

Source-tier badges (global/project/plugin, see Icons below) deliberately do **not** get their own
color family. A fourth set of hues would compete with the lint-status colors for attention —
icon + neutral badge keeps color meaning unambiguous across the whole table: color signals lint
status, full stop, nothing else in the UI is color-coded.

## Typography

**Geist Sans** for all UI text (nav, headings, body, buttons). **Geist Mono** for tabular/
code-like data — skill paths, version strings, plugin IDs, anything in the table that benefits
from tabular figures. Verified against `ui.shadcn.com` itself (the explicit minimalism
reference) rather than assumed — that site runs Geist, not Inter. Both are SIL Open Font
License, self-hostable, no Google Fonts CDN dependency.

No numeric scale existed before this pass — sizes and weights were left to per-component
judgment, which is exactly the kind of improvisation this doc exists to prevent. Locked, a
5-step scale, deliberately small and purpose-bound rather than a general-purpose type ramp:

| Use                           | Size / weight / family                                     |
| ----------------------------- | ---------------------------------------------------------- |
| App title (sidebar)           | 14px / 600 / Geist Sans                                    |
| Detail-panel title            | 16px / 600 / Geist Sans                                    |
| Table column headers          | 11px / 500 / uppercase / Geist Sans / `--muted-foreground` |
| Body / table cells            | 13px / 400 / Geist Sans                                    |
| Mono data (paths, plugin IDs) | 12px / 400 / Geist Mono / tabular-nums                     |

## Icons

**Lucide** (`lucide-react`, already a dependency, already `components.json`'s `iconLibrary`).
Reconsidered mid-session (the `iconLibrary` default turned out to be an unexamined shadcn-CLI
default, not a deliberate choice) and kept anyway on the merits: matches every shadcn block/
example you'll copy from `ui.shadcn.com` going forward, avoiding an ongoing manual icon-import
swap on every future component pull. Same visual quality bar (consistent stroke, geometric,
monochrome-by-default) as Linear's actual product UI, even though Linear's specific glyphs are a
proprietary in-house set (their "Orbiter" design system, built on Radix UI primitives) that
isn't available as a library to begin with.

### Badge icon assignments

Locked assignments, all Lucide, all icon **+** label — never icon-only, never color-alone (see
Accessibility below):

- **Source tier**: `Globe` (global), `FolderGit2` (project), `Blocks` (plugin) — neutral badge
  (`--muted` / `--border` tokens), no per-tier color; see Color above for why.
- **Plugin read-only marker**: trailing `Lock` icon on the Plugin badge, tooltip on hover —
  "Plugin-managed — read-only, may be overwritten on update." Satisfies
  `docs/mvp-build-spec.md`'s M2 requirement ("plugin entries visually marked read-only")
  explicitly, rather than relying on a user inferring read-only-ness from the word "Plugin" alone.
- **Lint status**: `CircleX` (error, `--destructive`), `TriangleAlert` (warning, `--warning`),
  `CircleCheck` (success, `--success`) — icon and color always paired, never color alone.
  Colorblind users can't reliably distinguish red/amber/green by hue.
- **Empty state**: one large muted-foreground icon (e.g. `FolderOpen` for the project-tier
  zero-skills state) above the heading/body/CTA — see Empty states below.

## Elevation

Not addressed at all before this pass. Locked: **border-first, shadow reserved for floating
layers.** The detail panel separates from the table with a 1px `--border`, not a drop shadow —
it's docked, not floating (see Shell above). Shadows are for genuinely transient/floating
elements only: dropdowns, popovers, tooltips, using shadcn's existing default shadow scale,
unchanged. Matches Linear's actual UI (bordered panels, shadow only on overlays) and keeps the
flat minimalism the rest of this doc calibrates toward — a shadowed, "lifted" detail panel would
read as conventional-dashboard, not deliberate.

## Motion

**CSS transitions only** — Tailwind's built-in utilities, 150–250ms, ease-out, for hover/active/
focus states, row-select highlight, and the detail-panel slide-in. No animation library (no
Framer/Motion). This isn't a blanket anti-dependency stance — see State management below for the
explicit correction on that — it's that nothing in a dashboard's motion vocabulary here
("state changes feel smooth") needs more than CSS provides. `prefers-reduced-motion` is
respected for free since these are plain CSS transitions, not JS-driven.

## State management

**TanStack Query for all IPC-backed state** (already locked in `CLAUDE.md`). Local/transient UI
state (detail-panel open/closed, selected row, command-palette open/closed once it exists) uses
plain `useState`/Context. **No Redux/Zustand for now** — re-examined this mid-session rather than
deferring to the fact that it was already written down (the original `CLAUDE.md` line predates
this conversation but was a genuine M0-session decision, not a silent default — confirmed via
`git blame`). Holds up independently: every piece of real state across M2–M6 is either IPC/
query-backed (table data, lint findings, usage stats, plugin registry — all Query's job) or
genuinely local (fits in Context). No cross-cutting, deeply interdependent client-state graph
exists yet that either library would actually solve.

Explicit note for future milestones: this is not "avoid new dependencies" as a blanket policy —
add one whenever it has real work to do (TanStack Table, `cmdk` when it lands, Geist's font
files are all additions made without hesitation this session). Revisit Redux/Zustand for real if
M6's plugin-remediation flow turns out to need more interdependent client state than Context
comfortably handles — that's the most likely future trigger, not a hypothetical one.

### Theme default & persistence

Not addressed before this pass — "theme preference" was named as local UI state without saying
what it defaults to or where it lives, and Electron isn't a browser: `localStorage` would work
but resets if the renderer's storage is ever cleared, and can't be read before the renderer
paints (a flash-of-wrong-theme risk `localStorage` can't avoid on its own). Locked: **default to
the OS setting** (`nativeTheme.shouldUseDarkColors`) on first launch — zero-config, respects
whatever the user already chose system-wide. If the user explicitly flips the sidebar toggle,
persist that override outside the renderer — **`electron-store` in the main process** — so it's
readable before first paint. This is a new dependency and a new main↔renderer IPC surface (a
get/set for the stored preference), not yet wired up; it lands with whichever milestone first
builds the sidebar, following this doc's own "add a dependency when it has real work to do"
principle rather than installing it speculatively now. (Follow-up for whoever picks this up: this
is exactly the kind of new IPC channel `CLAUDE.md`'s Exploration-budget carve-out flags — read
`isPathAllowed()` and the existing channel definitions first even though this channel doesn't
touch filesystem permissions itself, since it's still a new cross-process contract seam.)

## Data table

**TanStack Table**, not yet a dependency — add when M2 actually builds the table. shadcn's own
data-table recipe is built on it, so no separate design decision needed there.

**No virtualization yet.** Real `~/.claude` data on the dev machine is tens of skills, not
thousands — virtualizing now would be solving a problem that doesn't exist. Add
`@tanstack/react-virtual` if a real user's skill count ever makes the plain table measurably
slow, not preemptively.

### Column overflow

Mono columns (skill paths, `name@marketplace` plugin IDs) can run long; the fixed 36px row
height (see Layout & density above) rules out wrapping. Locked: **truncate with CSS
`text-overflow: ellipsis`, full value in a tooltip on hover** — reuses the same tooltip
convention as the plugin read-only marker rather than inventing a second hover pattern. No
horizontal scrollbar, no variable row height.

### Keyboard navigation

Table rows are focusable and arrow-key navigable: `↓`/`↑` moves selection, `Enter`/`Space` opens
the detail panel, `Esc` closes it (consistent with the Detail panel dismiss behavior above). Uses
the existing `--ring` token for the focus-visible ring — no new color introduced. Not optional
polish: `CLAUDE.md`'s "never simplify away... accessibility basics" rule applies directly to the
app's primary interactive surface, and shadcn/Radix's `Table` + focus-visible primitives get most
of this for free.

## Component vendoring strategy

Pull shadcn components **per-milestone, as needed** (`npx shadcn@latest add <component>`) —
matches the project's existing "land with the milestone" philosophy for scanner/UI files
(`CLAUDE.md`, "Deliberately not built yet"). Do not batch-vendor a speculative set of components
now. `Button` is the only one vendored so far (from M0).

M2's actual minimum, now that the detail panel, badges, and truncated columns are locked: a table
primitive, `Badge` (source-tier and lint-severity tags), a sheet/dialog for the detail panel, and
**`Tooltip`** (read-only marker, truncated-column overflow — both landed as real requirements
during this pass). Pull those when M2 actually starts, not before.

**Sonner/toast is explicitly not on that list** — see Empty / loading / error states below for
why.

## Empty / loading / error states

Per Taste Skill's general (non-landing-page-specific) guidance, which does transfer here:

- **Loading**: skeleton placeholders matching the final table/panel shape, not a generic spinner.
- **Empty**: project-tier will legitimately show zero skills until M3's picker ships. Locked
  visual form: a centered muted-foreground icon (`FolderOpen`), a short heading ("No project
  skills found"), one line of body text, and the CTA button ("Grant a folder to scan for
  skills") — consistent with the icon-forward badge/status language established above, rather
  than a text-only pattern nothing else in the app uses. Not a bug to route around; the milestone
  ordering already anticipates it (`docs/mvp-build-spec.md`).
- **Error**: inline, near the affected row/section. (Reworded from an earlier draft that said
  "not a toast for anything non-transient" — that phrasing implied a toast pattern existed
  somewhere in scope, and on inspection it doesn't: `docs/mvp-build-spec.md` has the M1 scan
  running automatically on app launch, not on a manual trigger, and v1 is read-only with no
  mutating action yet for a toast to confirm. Toast/Sonner is deferred, not adopted — see
  Deferred list below.)

## Accessibility

Pulls together threads decided piecemeal above into one place, so they're discoverable without
digging through Icons/Data table/Elevation individually:

- Every status signal pairs an icon with its color — never color alone (lint status, plugin
  read-only marker). Colorblind users can't reliably separate red/amber/green by hue.
- Focus states use the existing `--ring` token everywhere; no separate focus-color system.
- The table is fully keyboard-navigable (arrow keys, Enter/Space, Esc — see Data table above),
  not mouse/trackpad-only.

## Design QA tooling

`design-taste-frontend` (Taste Skill's adaptive flagship, installed at user/global scope) is the
governing skill for general anti-slop principles — color calibration, dark-mode-one-strategy,
interactive-state completeness, avoiding pure black/white, avoiding AI-purple defaults. **Its
landing-page-specific rules do not apply and were deliberately not used**: it says so itself
(Section 13, "Out of Scope" — dashboards/dense product UI/data tables are explicitly excluded).
Hero composition, bento grids, marquees, GSAP scroll-hijack patterns, testimonial-length rules —
none of that has a Megatron surface to attach to.

The other 12 skills bundled in the same `Leonxlnx/taste-skill` install (`brandkit`,
`industrial-brutalist-ui`, `gpt-taste`, etc.) are single fixed aesthetics, several of which
actively conflict with this doc (banning Inter/Lucide, for instance) — left installed but
intentionally unused for this project.

`Impeccable` (`pbakaus/impeccable`, Claude Code plugin, user scope) is installed for **later**:
its detector/audit commands (`/impeccable audit`, etc.) need a real rendered UI to check against,
which doesn't exist yet. Revisit once M2 ships an actual screen.

Two style-reference DESIGN.md files were evaluated and rejected as a foundation (an "Air" style
board from `styles.refero.design`, and that same site's "Linear" extraction) — both are scraped
from public marketing sites, not authenticated product UI, confirmed by direct inspection (even
the Linear entry has zero table/sidebar/list components, only hero/logo-bar/CTA patterns). This
class of source structurally cannot produce a dense-product-UI system regardless of which brand
name is on it — worth remembering before reaching for another one.

## Deferred, not blocking M2

- Command palette (`cmdk`) — see Shell section above.
- Border radius scale — shadcn's existing default (`--radius: 0.625rem`) is unchanged; no reason
  surfaced to deviate from it under a minimalism-first direction.
- Exact off-white replacement value for `main.css`'s light-mode background.
- Chart library — not needed before M5 (usage stats); don't pick one preemptively.
- Sonner/toast — no transient mutating action exists in M2's scope to attach it to (see Empty /
  loading / error states above). Revisit once M3's grant-a-folder flow, or any later milestone,
  introduces a real one.
