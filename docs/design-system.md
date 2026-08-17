# Megatron: Design System

Reference for UI work. Captures the design decisions made before any renderer screen existed,
so `SkillInventory.tsx` and everything after it has a concrete system to build from instead of
improvised per-component choices. `CLAUDE.md` remains authoritative for repo-wide architecture
decisions; this doc is authoritative for the renderer, and owns the locked decisions listed
below.

## Locked decisions

| Area           | Decision                                                                        | Why                                                          |
| -------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Renderer state | TanStack Query for IPC-backed data, plain `useState`/Context for local UI state | No Redux/Zustand — not enough state complexity to justify it |

See State management below for how the split is applied in practice.

This revision closes the branches the first draft left open — window chrome, density, type
scale, elevation, badge iconography, and accessibility — via a dependency-ordered interview
(each answer constrained the next: window chrome before sidebar contents, sidebar contents
before the active-state indicator, elevation before detail-panel mechanics, badge icon language
before the read-only marker). Resolved in that order below.

## Shell / information architecture

**Sidebar + list/detail, Linear-style.** Persistent left sidebar, main pane is the dense skills
table; clicking a row replaces the table with a fullscreen file viewer for that skill (see Skill
file viewer below — this superseded an earlier right-side detail panel design once the app was
actually used). No command-palette-primary navigation, no marketing-page patterns — Megatron is a single-domain
utility app (CLAUDE.md's scope is deliberately "skills only, no sessions/repo UI"), not a
multi-section product with enough distinct surfaces to justify heavier navigation chrome.

Command palette (`cmdk`, matching shadcn's `Command` component): **built, post-M2.** Was deferred
during M2 itself (not a requirement of M2's actual scope — `docs/mvp-build-spec.md`: "list every
skill... tagged by origin"), with an explicit revisit trigger: "once the table has enough rows to
make browsing alone insufficient." That trigger fired — 31 real skills on the dev machine (25
global + 6 plugin) is past one screenful — surfaced while comparing Megatron against
`references/skills-manager`. `⌘K`/`Ctrl+K` opens a `CommandDialog` searching all skills by name and
description regardless of the active sidebar filter; selecting one opens its fullscreen file
viewer. Uses cmdk's built-in filtering, no custom matcher.

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

`hiddenInset` on its own only removes the OS titlebar — it doesn't make the window draggable.
That needed a second piece: a 40px `-webkit-app-region: drag` strip spanning the full window
width, above both sidebar and table (a Tailwind `@utility drag-region` in `main.css`). The strip
is empty chrome, no content — the "Megatron" wordmark stays in the sidebar below it. The
sidebar's old top padding (clearing the traffic lights before this strip existed) moved out of
the sidebar and became the strip's height instead.

### Sidebar composition

Not specified before this pass beyond "persistent left sidebar." Locked contents, top to bottom:
app wordmark ("Megatron"), a static filter nav (`All Skills` / `Global` / `Project` / `Plugin` —
filtering the table by `source_type`, the one dimension `docs/data-model.md` already treats as
structural), a flex spacer, and a light/dark toggle pinned at the bottom. No
search box (table doesn't need one yet at current row counts — same reasoning as "no
virtualization yet" under Data table below), no settings gear (nothing to configure in a
read-only v1).

The nav's active-state indicator is the lime accent — this is the "one selected/active-state
indicator" use case the Color section below already reserved lime for, now assigned concretely
instead of left abstract.

### Skill file viewer

Superseded the original docked 360px metadata panel — revisited once the app was actually
clicked around in, not on paper. A panel that only echoed columns already visible in the table
(source, description) never earned the click; what a user wants on opening a skill is the skill
itself. **Fullscreen, replacing the table pane, not layered over it** — the sidebar stays visible
and usable (filters, theme toggle) but the table is gone until you close back out, same
mechanism as swapping table for panel content used to be, just at full width instead of 360px.

Layout: a header (see Revised: header layout below), a file tree on the left covering the skill's
whole directory (not just `SKILL.md`), and a content pane on the right showing the selected file.
`SKILL.md` is selected by default. Files skip dotfiles, cap preview content at 256KB, and mark
binary/undecodable content as unreadable rather than showing mojibake. `last_scanned_at` is
dropped from the header, it's scan bookkeeping nobody opens a file to check.

**Revised: header layout.** Originally one two-row header (name/source badge/path on a
`justify-between` row, then description and frontmatter chips sharing one wrapped flex line).
Reworked after that packed seven distinct data types — back button, title, source badge, absolute
path, prose description, and N frontmatter chips — into two rows tight enough to read as crowded
and misaligned once real skill data (long paths, multi-field frontmatter) filled it in.
Reference (layout/hierarchy only, not literal code) drawn from two 21st.dev page-header patterns
that group title + status badge as one left-aligned unit rather than splitting them: no new
dependency, rebuilt with existing tokens. Now four stacked rows, indented under the title
(`pl-8`, past the back button) except the identity row itself:

1. **Identity row** — back button, title (`truncate`), source badge. Flush left, no
   `justify-between` — that property was the actual alignment bug, splitting the button and title
   to opposite ends of the row.
2. **Path** — its own line, Geist Mono, `truncate` with a native `title` attribute carrying the
   full value (same cheap precedent `SourceBadge` already uses over a richer `Tooltip`).
3. **Description** — renders in full, no line-clamp, `max-w-[72ch]` (the same prose-measure
   exception Markdown rendering below already carves out). Header height now varies per skill;
   traded deliberately for the description actually being readable, which was the point of the
   rework. Row is omitted entirely when there's no description.
4. **Frontmatter chips** — now `Badge` (`variant="outline"`), the same pill `SourceBadge` uses,
   instead of a bespoke `rounded-sm`/`bg-muted`/all-mono `<span>`. One pill vocabulary in the
   header instead of two competing ones; the key stays Geist Sans, the value stays Geist Mono
   inside the pill since it's literal declared data.

The usage-stats strip below the header (est. tokens, uses, trigger-type breakdown) is untouched —
still its own bordered strip, per Elevation's border-first stance below.

**Revised: markdown rendering.** This section originally locked "raw monospace text — no markdown
rendering, no syntax highlighting... rather than adding a rendering dependency for a read-only
v1." Reversed once the app was actually used to read real `SKILL.md` files — undifferentiated
plaintext made the single most-read surface in the app the least readable one. `.md`/`.markdown`
files now render via `react-markdown` + `remark-gfm` (tables/task-lists/strikethrough); every other
file type is untouched, still the original raw Geist Mono `<pre>`. Scoped narrowly, not a general
reopening of the v1-minimalism stance:

- **No syntax highlighter.** Fenced code gets a plain bordered/`bg-muted` box in Geist Mono, no
  colored tokens — which is also why standalone script files in the tree stay unhighlighted; the
  only reason to add one (matching fenced-code styling) doesn't apply.
- **No raw HTML.** `react-markdown` escapes embedded HTML by default; that default is kept
  deliberately — skill files are third-party content read off disk, and enabling raw HTML would
  make an embedded `<script>` executable in a non-sandboxed renderer.
- **No local image rendering.** An `![]()` referencing a file in the skill directory renders as
  alt text / a broken-image placeholder. Real image bytes would need a new binary-read IPC channel
  (today's `skills:open` returns all file content as UTF-8 text, `status: 'unreadable'` for binary)
  — deferred until a real skill actually embeds one; none on the dev machine do.
- **No rendered/raw toggle.** One view per file, same as every other file type in this viewer.
- **Links work.** A relative link to another file in the same skill directory selects that file in
  the tree (same selection state the tree itself drives). An `http(s)` link opens via the OS
  browser, through a new `shell:openExternal` IPC channel that validates the scheme in the main
  process (`src/main/shell.ts`) before calling `shell.openExternal` — the renderer is not trusted
  to gate this itself, since the URL originates from scanned third-party content.
- **Frontmatter moves into the header**, not the rendered body — `name` was already redundant with
  the header's own title, and `description` now renders there as a subtitle. Any *other* top-level
  scalar frontmatter field (string/number/boolean) a `SKILL.md` declares — e.g. `argument-hint`,
  `license` — renders as a small `key: value` chip next to it. Not a hardcoded field list: whatever
  a skill's frontmatter actually declares just shows up, since `yaml.parse()` already gives the
  whole object and only `name`/`description` are deliberately dropped. Arrays/objects are skipped.
- **Prose gets a `max-w-[72ch]` measure** — a scoped exception to the "Content max-width: None" row
  under Layout & density below, which was written for the fluid table; a full-window line length is
  genuinely unreadable for prose. Code blocks and tables inside markdown still scroll horizontally
  in their own `overflow-x-auto` container rather than widening the pane.

`MarkdownView.tsx` is hand-owned, one tier above `components/ui/`, alongside `FileTree.tsx` — same
rationale already recorded there: a heavily-adapted/composed piece (an explicit `components` map
mapping every markdown element to this doc's existing tokens), not an untouched shadcn CLI pull.
Considered and skipped: `@tailwindcss/typography`. Its `prose` defaults carry their own type/color
opinions that would have to be fought back with `prose-*` overrides to land on the locked 5-step
scale below — a direct component map is less code and exactly on-token from the start.

**File tree, revised**: real skill directories turned out to have high sibling counts within a
directory (a `references/` folder with 15+ flat files, several `scripts/<name>/` subtrees) — a
flat, always-expanded, indentation-only render crowded out at that shape even though its own
"never nests past 3 levels" bet on depth held. Now: collapsible (all directories start collapsed,
root-level files visible — the direct fix for the crowding), per-extension file icons, a filter
input above the tree that narrows to matching files and auto-reveals their ancestor directories
regardless of manual expand state, and virtualized rendering (`@tanstack/react-virtual`) so a
large directory doesn't mount hundreds of DOM rows at once. See Motion above for what animates
here and why the reference implementation's whole-subtree slide-open animation couldn't survive
virtualization.

The tree pane is **user-resizable by dragging** (200–480px range, 240px default) rather than a
wider fixed width, so long filenames aren't a layout decision made once for every skill — the
dragged width lives in `App.tsx` state and survives switching between skills within a session,
resetting to 240px on app restart (not persisted to disk; nothing here currently justifies the
IPC surface `electron-store` persistence would need — see Theme default & persistence below for
the pattern this would follow if that changes).

Closes via **Esc or an explicit `×` button** in the header — same convention the panel used,
kept because it still holds: there's no "outside" to click once the view covers the table anyway.
**Revised for the tree's filter input**: Esc is now layered — it clears a non-empty filter first,
and only closes the viewer when the filter is already empty. Two presses always gets you out.

## Layout & density

No spacing/sizing scale existed before this pass. Locked, calibrated for a dense Linear-style
table rather than a spacious admin dashboard:

| Element                | Value                                                                       |
| ---------------------- | --------------------------------------------------------------------------- |
| Base spacing unit      | Tailwind's default 4px scale, unchanged — nothing here needs a custom scale |
| Sidebar width          | 220px, fixed                                                                |
| Drag strip height      | 40px, fixed — full window width, empty chrome above sidebar + table         |
| Table row height       | 40px (was 36px — revised for more breathing room once Path was cut)         |
| Table cell padding     | 8px / 12px                                                                  |
| File viewer tree width | 240px default, resizable 200–480px (see Skill file viewer above)            |
| Content max-width      | None — fluid, fills the window. **Exception**: rendered markdown prose caps at `72ch` (see Markdown rendering under Skill file viewer above) — a full-window line length is unreadable for prose even though it's correct for the table |

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

**Extended for rendered markdown** (`MarkdownView.tsx`, see Skill file viewer above): the 5-step
scale above is UI-purpose-bound and has no row for arbitrary prose headings, so rendered `.md`
content gets its own small descending scale rather than reusing the Detail-panel title size for
every heading level — h1 20px/600, h2 16px/600, h3 14px/600, h4–h6 13px/600 (h4 and below share the
locked Body size rather than inventing sizes smaller than body text, which real skill docs rarely
use anyway). All Geist Sans; fenced/inline code stays Geist Mono at the existing 12px mono-data
step.

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
layers.** The skill file viewer's header and file tree separate with a 1px `--border`, not a
drop shadow — it replaces the table pane in place rather than floating over it (see Skill file
viewer above). Shadows are for genuinely transient/floating elements only: dropdowns, popovers,
tooltips, using shadcn's existing default shadow scale, unchanged. Matches Linear's actual UI
(bordered panels, shadow only on overlays) and keeps the flat minimalism the rest of this doc
calibrates toward — a shadowed, "lifted" panel would read as conventional-dashboard, not
deliberate.

## Motion

**CSS transitions are still the default** — Tailwind's built-in utilities, 150–250ms, ease-out,
for hover/active/focus states and simple color/opacity changes. `prefers-reduced-motion` is
respected for free wherever these are used, since they're plain CSS, not JS-driven.

**Revised: `motion` (the Framer Motion successor) is permitted**, narrowly, for state-change
feedback CSS transitions can't express — a shared highlight box gliding between positions, or a
newly-revealed row fading/sliding in on mount. First landed on the skill file viewer's tree (see
Skill file viewer below): virtualizing that tree for scale meant abandoning the earlier
recursive-DOM approach where a whole collapsed subtree could animate open via `height: auto` —
under virtualization, collapsed children simply aren't mounted, so there's no container left to
animate a height on. What survives is per-row animation (icon rotation, highlight glide, row
fade-in), which is exactly what `motion` is scoped to here. Because this animation is JS-driven,
`prefers-reduced-motion` is **not** free anymore where `motion` is used — every surface using it
checks `useReducedMotion()` explicitly and disables its animations when set.

**Extended to the skills table and the sidebar's filter nav**, for the same shared-glide pattern:
both now track pointer hover and animate a `motion` element to the hovered row/item's position
instead of each row/item toggling its own background independently. Shared tracking logic
(hovered-id state, the reduced-motion-aware spring transition) lives in one hook
(`lib/use-glide-highlight.ts`) rather than being copied three times; position math, shape, and
whether an entrance fade applies stay owned by each surface, since row height and layout genuinely
differ (the table also gained FileTree's row fade-in-on-mount, for filter-switch/sort; the nav
did not — it's a static 4-item list that never reorders or remounts). The table's glide stayed
full-bleed/unrounded rather than adopting the tree's inset rounded-pill shape — Elevation's
border-first stance below rejects a "lifted panel" look, which an inset rounded highlight over a
bordered grid would read as. Both surfaces track hover only, not keyboard focus — the table's
existing focus-visible ring (see Keyboard navigation below) stays as the sole focus indicator.

This is a reversal of this doc's earlier "no animation library" stance, made deliberately rather
than silently — CLAUDE.md's "no silent regressions" applies to locked doc decisions too. It does
not reopen the door to a general-purpose animation library across the app: CSS transitions remain
the default everywhere else (including the sidebar's theme toggle, untouched by the above), and
`motion` is reached for only where a shared/persistent element needs to animate across a state
change that CSS alone can't express — now three known call sites, not an open-ended policy.

## State management

**TanStack Query for all IPC-backed state** (locked in Locked decisions above). Local/transient UI
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

**No virtualization yet for the skills table itself.** Real `~/.claude` data on the dev machine is
tens of skills, not thousands — virtualizing now would be solving a problem that doesn't exist.
Add `@tanstack/react-virtual` here too if a real user's skill count ever makes the plain table
measurably slow, not preemptively.

`@tanstack/react-virtual` **is** now a dependency — it landed for the skill file viewer's file
tree (see Skill file viewer below), where a single skill directory's file count, not the skills
table's row count, was the actual scaling concern.

### Columns

Three columns: Name, Source, Description. **Path was cut** — a truncated absolute path needing
a tooltip to be legible at all was spending the table's widest column on data nobody read from
the table itself; it now lives in the file viewer's header instead (see Skill file viewer above),
reachable once you've actually committed to a skill. Name and Source are fixed-width
(`table-fixed` layout, 220px / 120px); Description fills the remaining space. Locked: **truncate
with CSS `text-overflow: ellipsis`** on Description and (if a name is unusually long) Name — no
horizontal scrollbar, no variable row height. The Path column's tooltip-on-hover convention is
gone with it; nothing in the current column set needs a tooltip.

### Keyboard navigation

Table rows are focusable and arrow-key navigable: `↓`/`↑` moves selection, `Enter`/`Space` opens
the fullscreen file viewer, `Esc` closes it (consistent with the file viewer's dismiss behavior
above). Uses the existing `--ring` token for the focus-visible ring — no new color introduced.
Not optional polish: `CLAUDE.md`'s "never simplify away... accessibility basics" rule applies
directly to the app's primary interactive surface, and shadcn/Radix's `Table` + focus-visible
primitives get most of this for free.

## Component vendoring strategy

Pull shadcn components **per-milestone, as needed** (`npx shadcn@latest add <component>`) —
matches the project's existing "land with the milestone" philosophy for scanner/UI files
(`docs/mvp-build-spec.md`, "Deferred, on purpose"). Do not batch-vendor a speculative set of components
now. `Button` is the only one vendored so far (from M0).

M2's actual minimum, now that badges and truncated columns are locked: a table primitive, `Badge`
(source-tier and lint-severity tags), and **`Tooltip`** (read-only marker, truncated-column
overflow). The skill file viewer itself (see above) needed no new vendored component beyond
`Input` (the tree's filter box) — it's a plain conditional swap for the table pane, not a
`Dialog`/sheet overlay, since it's meant to replace the table rather than float over it. The file
tree component itself is **not** a shadcn vendor pull — it's hand-owned at
`components/FileTree.tsx`, one tier up from `components/ui/`, alongside `CommandPalette.tsx`,
because it's built from a heavily-adapted third-party reference rather than an untouched CLI pull
(see Motion above). `MarkdownView.tsx` joined that same tier for the same reason once markdown
rendering landed (see Skill file viewer above) — `react-markdown` + `remark-gfm` are real new
dependencies here, not a shadcn pull; no syntax-highlighter or `@tailwindcss/typography` dependency
was added alongside them (see the Markdown rendering note above for why).

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
- The skill file viewer's file tree follows the standard `role="tree"`/`treeitem` keyboard
  pattern (↑/↓ moves, →/← expands/collapses or steps to a child/parent, Home/End jumps to the
  first/last visible row, Enter/Space activates) with roving `tabIndex`, and disables its
  `motion` animations under `prefers-reduced-motion` (see Motion above — not free here, since this
  animation is JS-driven, unlike the table's CSS transitions).

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
