# Megatron: Design System

Reference for renderer UI work — the locked decisions below are what `SkillInventory.tsx` and
every screen after it build from, not a set of per-component judgment calls. `CLAUDE.md` remains
authoritative for repo-wide architecture; this doc owns the renderer.

## Locked decisions

| Area           | Decision                                                                        | Why                                                          |
| -------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| Renderer state | TanStack Query for IPC-backed data, plain `useState`/Context for local UI state | No Redux/Zustand — not enough state complexity to justify it |

See State management below for how the split is applied in practice.

## Shell / information architecture

**Sidebar + list/detail, Linear-style.** Persistent left sidebar; main pane is the dense skills
table. Clicking a row replaces the table with a fullscreen file viewer for that skill (see Skill
file viewer below). No command-palette-primary navigation, no marketing-page patterns — Megatron
is a single-domain utility app (skills only, no sessions/repo UI), not a multi-section product.

**Command palette** (`cmdk`, shadcn's `Command` component): built. `⌘K`/`Ctrl+K` opens a
`CommandDialog` searching all skills by name/description regardless of the active sidebar filter;
selecting one opens its fullscreen file viewer. Uses cmdk's built-in filtering, no custom matcher.
This doesn't reopen the sidebar's "no search box" decision below — the palette is a modal dialog,
a different surface.

### Window chrome

`titleBarStyle: 'hiddenInset'` (Electron `BrowserWindow`, `src/main/index.ts`). Traffic lights
float over the sidebar's top-left corner instead of a full OS titlebar row — same effect
Linear/Slack/Notion desktop use. The sidebar's top nav item is padded below macOS's traffic-light
hit zone (~28px).

`hiddenInset` alone doesn't make the window draggable: a 40px `-webkit-app-region: drag` strip
spans the full window width above both sidebar and table (Tailwind `@utility drag-region` in
`main.css`), empty chrome — the "Megatron" wordmark stays in the sidebar below it.

### Sidebar composition

Top to bottom: app wordmark ("Megatron"), a static filter nav (`All Skills` / `Global` /
`Project` / `Plugin` — filtering by `source_type`), a flex spacer, a light/dark toggle pinned at
the bottom. No search box (table doesn't need one at current row counts), no settings gear
(nothing to configure in a read-only v1).

The nav's active-state indicator uses the lime accent (see Color below).

### Skill file viewer

**Fullscreen, replacing the table pane, not layered over it** — sidebar stays visible and usable
(filters, theme toggle), table is gone until closed. A docked metadata panel was tried and
dropped: it only echoed columns already visible in the table and never earned the click.

Layout: a header (below), a file tree on the left covering the skill's whole directory, a content
pane on the right showing the selected file. `SKILL.md` selected by default. Dotfiles skipped,
preview capped at 256KB, binary/undecodable content marked unreadable rather than shown as
mojibake.

**Header**, four stacked rows (indented `pl-8` under the title except the identity row):

1. **Identity row** — back button, title (`truncate`), source badge. Flush left.
2. **Path** — own line, Geist Mono, `truncate` with a native `title` attribute for the full value.
3. **Description** — renders in full, no line-clamp, `max-w-[72ch]`. Omitted when there's no
   description.
4. **Frontmatter chips** — `Badge` (`variant="outline"`), one per scalar frontmatter field, key in
   Geist Sans / value in Geist Mono. Arrays/objects skipped.

The usage-stats strip below the header (est. tokens, uses, trigger-type breakdown) is its own
bordered strip, per Elevation's border-first stance below.

**Markdown rendering.** `.md`/`.markdown` files render via `react-markdown` + `remark-gfm`
(tables/task-lists/strikethrough); every other file type stays raw Geist Mono `<pre>`.

- No syntax highlighter — fenced code gets a plain bordered/`bg-muted` box in Geist Mono.
- No raw HTML — `react-markdown`'s default escaping is kept (skill files are third-party content
  read off disk; a non-sandboxed renderer shouldn't execute an embedded `<script>`).
- No local image rendering — `![]()` renders as alt text/broken-image placeholder (`skills:open`
  returns file content as UTF-8 text only; a binary-read IPC channel would be needed).
- No rendered/raw toggle — one view per file, same as every other file type.
- Links: a relative link to another file in the skill directory selects that file in the tree. An
  `http(s)` link opens via the OS browser through `shell:openExternal` (`src/main/shell.ts`),
  which validates the scheme in the main process — the renderer isn't trusted to gate this since
  the URL originates from scanned third-party content.
- Frontmatter renders in the header, not the body — `name`/`description` are dropped from the
  rendered markdown since they're already shown there. Any other scalar field renders as a header
  chip.
- Prose gets `max-w-[72ch]` — the one exception to "Content max-width: none" under Layout &
  density below.

`MarkdownView.tsx` is hand-owned, one tier above `components/ui/`, alongside `FileTree.tsx` — a
composed piece with an explicit element map onto this doc's tokens, not an untouched shadcn pull.
`@tailwindcss/typography` was considered and skipped: its `prose` defaults fight the locked
5-step type scale below more than a direct component map costs.

**File tree**: collapsible (all directories start collapsed, root-level files visible),
per-extension file icons, a filter input above the tree that narrows to matching files and
auto-reveals their ancestor directories, virtualized rendering (`@tanstack/react-virtual`) so a
large directory doesn't mount hundreds of DOM rows. User-resizable by dragging (200–480px range,
240px default) — lives in `App.tsx` state, survives switching skills within a session, resets to
240px on app restart (not persisted to disk).

Closes via **Esc or an explicit `×` button** in the header. Esc is layered for the filter input:
clears a non-empty filter first, only closes the viewer when the filter is already empty.

## Layout & density

Calibrated for a dense Linear-style table, not a spacious admin dashboard:

| Element                | Value                                                            |
| ------------------------ | ------------------------------------------------------------------- |
| Base spacing unit       | Tailwind's default 4px scale, unchanged                          |
| Sidebar width           | 220px, fixed                                                     |
| Drag strip height       | 40px, fixed — full window width                                 |
| Table row height        | 40px                                                             |
| Table cell padding     | 8px / 12px                                                       |
| File viewer tree width  | 240px default, resizable 200–480px                               |
| Content max-width       | None — fluid. Exception: rendered markdown prose caps at `72ch`  |

## Color

Base: shadcn `new-york` / `neutral` (`components.json`).

| Role                | Value                             | Notes                                                                                                                                                                                                                          |
| --------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Accent              | Acid lime `#E4F222`               | Narrow use only — primary action buttons and one selected/active-state indicator (the sidebar's active filter-nav item). Never body text or links — text-weight lime on a light background reads poorly. Filled buttons with dark text on lime hold contrast fine in both themes. |
| Error / destructive | shadcn `--destructive` (existing) | Lint errors                                                                                                                                                                                                                     |
| Warning             | `--warning` token, amber family   | Lint warnings                                                                                                                                                                                                                   |
| Success             | `--success` token, green family   | Passing lint / up to date                                                                                                                                                                                                      |

Rules: one accent, used sparingly. No pure white/black — light-mode background should move off
literal `oklch(1 0 0)` toward something like `oklch(0.99 0 0)` (dark mode's `oklch(0.145 0 0)` is
already off-black). Status colors (red/amber/green) stay visually distinct from the accent lime.
Source-tier badges (global/project/plugin) don't get their own color family — icon + neutral badge
keeps color meaning unambiguous: color signals lint status, full stop.

## Typography

**Geist Sans** for all UI text. **Geist Mono** for tabular/code-like data — skill paths, version
strings, plugin IDs. Both SIL Open Font License, self-hostable.

| Use                            | Size / weight / family                                    |
| --------------------------------- | -------------------------------------------------------------- |
| App title (sidebar)            | 14px / 600 / Geist Sans                                    |
| Detail-panel title             | 16px / 600 / Geist Sans                                    |
| Table column headers           | 11px / 500 / uppercase / Geist Sans / `--muted-foreground` |
| Body / table cells             | 13px / 400 / Geist Sans                                    |
| Mono data (paths, plugin IDs)  | 12px / 400 / Geist Mono / tabular-nums                     |

**Rendered markdown** gets its own descending scale rather than reusing UI sizes: h1 20px/600,
h2 16px/600, h3 14px/600, h4–h6 share the Body size. All Geist Sans; fenced/inline code stays
Geist Mono at the 12px mono-data step.

## Icons

**Lucide** (`lucide-react`) — matches shadcn's own blocks/examples and Linear's visual quality bar
(consistent stroke, geometric, monochrome-by-default).

### Badge icon assignments

All Lucide, all icon **+** label — never icon-only, never color-alone:

- **Source tier**: `Globe` (global), `FolderGit2` (project), `Blocks` (plugin) — neutral badge,
  no per-tier color.
- **Plugin read-only marker**: trailing `Lock` icon on the Plugin badge, tooltip on hover
  ("Plugin-managed — read-only, may be overwritten on update").
- **Lint status**: `CircleX` (error, `--destructive`), `TriangleAlert` (warning, `--warning`),
  `CircleCheck` (success, `--success`) — icon and color always paired.
- **Empty state**: one large muted-foreground icon (e.g. `FolderOpen`) above heading/body/CTA.

## Elevation

**Border-first, shadow reserved for floating layers.** The skill file viewer's header/tree
separate with a 1px `--border`, not a drop shadow. Shadows are for genuinely transient/floating
elements only (dropdowns, popovers, tooltips), shadcn's default shadow scale, unchanged.

## Motion

**CSS transitions are the default** — Tailwind's built-in utilities, 150–250ms, ease-out, for
hover/active/focus states and simple color/opacity changes. `prefers-reduced-motion` is respected
for free since these are plain CSS.

**`motion` (Framer Motion successor) is permitted narrowly**, for state-change feedback CSS can't
express: a shared highlight box gliding between positions, or a row fading/sliding in on mount.
Three call sites: the skill file viewer's tree (per-row icon rotation, highlight glide, fade-in —
needed once virtualization ruled out a `height: auto` whole-subtree animation), the skills table,
and the sidebar's filter nav (both track pointer hover and animate a shared `motion` element to
the hovered row/item's position, via one shared hook `lib/use-glide-highlight.ts`; the nav skips
entrance fade since it's a static 4-item list). The table's glide is full-bleed/unrounded, not the
tree's inset rounded-pill shape, to match Elevation's border-first stance. Both track hover only,
not keyboard focus — the existing focus-visible ring stays the sole focus indicator.

Every surface using `motion` checks `useReducedMotion()` explicitly, since JS-driven animation
doesn't get `prefers-reduced-motion` for free. `motion` is scoped to these three call sites, not a
general-purpose animation library — CSS transitions remain the default everywhere else.

## State management

**TanStack Query for all IPC-backed state** (Locked decisions above). Local/transient UI state
(detail-panel open/closed, selected row, command-palette open/closed) uses plain
`useState`/Context. No Redux/Zustand — every piece of real state so far is either Query-backed or
genuinely local; no cross-cutting, deeply interdependent client-state graph exists yet that either
library would solve. Not a blanket "avoid new dependencies" policy — add one whenever it has real
work to do. Revisit Redux/Zustand if a future milestone's flow needs more interdependent client
state than Context comfortably handles.

### Theme default & persistence

**Defaults to the OS setting** (`nativeTheme.shouldUseDarkColors`) on first launch. If the user
flips the sidebar toggle, the override is persisted in the main process — **`electron-store`**
(`theme.ts`) — so it's readable before first paint (`localStorage` can't be read before the
renderer paints, and resets if cleared). Wired through two IPC channels, `theme:getInitial` /
`theme:set`.

## Data table

**TanStack Table** (`@tanstack/react-table`) backs the skills table, per shadcn's own data-table
recipe.

**No virtualization for the skills table itself** — real `~/.claude` data is tens of skills, not
thousands. `@tanstack/react-virtual` **is** a dependency, but for the skill file viewer's file
tree (a single skill directory's file count, not the table's row count, is the actual scaling
concern).

### Columns

Three columns: Name, Source, Description. Path was cut — a truncated absolute path needing a
tooltip to be legible was spending the table's widest column on data nobody read from the table
itself; it lives in the file viewer's header instead. Name and Source are fixed-width
(`table-fixed`, 220px / 120px); Description fills the remaining space. Truncate with CSS
`text-overflow: ellipsis` on Description and (if unusually long) Name — no horizontal scrollbar,
no variable row height.

### Keyboard navigation

Table rows are focusable and arrow-key navigable: `↓`/`↑` moves selection, `Enter`/`Space` opens
the fullscreen file viewer, `Esc` closes it. Uses the existing `--ring` token for the
focus-visible ring.

## Component vendoring strategy

Pull shadcn components per-milestone, as needed (`npx shadcn@latest add <component>`) — no
batch-vendoring a speculative set now. Vendored so far: `Button`, plus a table primitive,
`Badge`, `Tooltip`, `Input` for M2's actual minimum. Hand-owned, one tier above
`components/ui/` (heavily-adapted third-party references, not untouched CLI pulls):
`FileTree.tsx`, `CommandPalette.tsx`, `MarkdownView.tsx`.

Sonner/toast is explicitly not vendored — see Empty / loading / error states below.

## Empty / loading / error states

- **Loading**: skeleton placeholders matching the final table/panel shape, not a generic spinner.
- **Empty**: project-tier legitimately shows zero skills until the user grants a folder via
  Manage Folders. Centered muted-foreground icon (`FolderOpen`), a short heading ("No project
  skills found"), one line of body text, a CTA button ("Grant a folder to scan for skills").
- **Error**: inline, near the affected row/section — no toast, since v1 is read-only with no
  mutating action yet for a toast to confirm.

## Accessibility

- Every status signal pairs an icon with its color — never color alone (lint status, plugin
  read-only marker).
- Focus states use the existing `--ring` token everywhere; no separate focus-color system.
- The table is fully keyboard-navigable (see Data table above), not mouse/trackpad-only.
- The skill file viewer's file tree follows the standard `role="tree"`/`treeitem` pattern (↑/↓
  moves, →/← expands/collapses or steps to a child/parent, Home/End jumps to first/last visible
  row, Enter/Space activates) with roving `tabIndex`, and disables `motion` animations under
  `prefers-reduced-motion`.

## Design QA tooling

`design-taste-frontend` (Taste Skill's adaptive flagship) governs general anti-slop principles —
color calibration, dark-mode-one-strategy, interactive-state completeness, avoiding pure
black/white and AI-purple defaults. Its landing-page-specific rules (hero composition, bento
grids, marquees, testimonial-length rules) don't apply — it excludes dashboards/dense product UI
itself (Section 13). The other 12 skills bundled in the same install are single fixed aesthetics
that actively conflict with this doc (e.g. banning Inter/Lucide) — left installed, intentionally
unused here.

`Impeccable` (Claude Code plugin) is installed for later — its audit commands need a real
rendered UI to check against, which doesn't exist yet.

Two style-reference DESIGN.md files (an "Air" board and a "Linear" extraction, both from
`styles.refero.design`) were evaluated and rejected as a foundation — both are scraped from public
marketing sites, not authenticated product UI (even the Linear entry has zero table/sidebar/list
components). This class of source can't produce a dense-product-UI system regardless of brand
name.

## Deferred, not blocking M2

- Border radius scale — shadcn's default (`--radius: 0.625rem`), unchanged.
- Exact off-white replacement value for `main.css`'s light-mode background.
- Chart library — not needed before M5 (usage stats).
- Sonner/toast — no transient mutating action exists in scope to attach it to.
